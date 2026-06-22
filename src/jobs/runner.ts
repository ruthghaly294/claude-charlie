import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { DB } from "@/db/client";
import { jobs, jobRuns, type NewJobRow, type NewJobRunRow } from "@/db/schema";
import { parseConfig, type ScheduleConfig } from "@/discovery/config";
import type { JobContext, JobKind, JobRegistry } from "./registry";

export type TickOptions = {
  /** injectable clock (ms), defaults to Date.now */
  clock?: () => number;
  /** injectable sleep, defaults to a real setTimeout-based wait */
  sleep?: (ms: number) => Promise<void>;
  /** injectable randomness (0..1) used for jitter, defaults to Math.random */
  random?: () => number;
  /** per-kind recurring schedules; a kind with no schedule is never re-enqueued automatically */
  schedules?: Partial<Record<JobKind, ScheduleConfig>>;
  /** if set, only claim jobs of these kinds (e.g. the in-process trend worker drains only its own kind) */
  kinds?: JobKind[];
  /** overrides merged into the JobContext passed to each job's `run` */
  ctx?: Partial<Pick<JobContext, "config" | "env" | "signal" | "connectors" | "fetchImpl">>;
};

export type TickResult = { claimed: number; ok: number; failed: number; dead: number };

export type EnqueueOptions = {
  payload?: unknown;
  runAt?: string;
  now?: () => string;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function timeoutAfter(ms: number, sleep: (ms: number) => Promise<void>): Promise<never> {
  return sleep(ms).then(() => {
    throw new Error(`job timed out after ${ms}ms`);
  });
}

/** Multiply `ms` by a random factor within +/-`pct` (e.g. pct=0.15 -> +/-15%). */
function jitter(ms: number, pct: number, random: () => number): number {
  return ms * (1 + (random() * 2 - 1) * pct);
}

/** Insert a pending job, taking `maxAttempts` from the registry definition for `kind`. */
export function enqueueJob(
  db: DB,
  kind: JobKind,
  registry: JobRegistry,
  opts: EnqueueOptions = {},
): string {
  const now = opts.now ?? (() => new Date().toISOString());
  const id = randomUUID();
  const row: NewJobRow = {
    id,
    kind,
    payload: opts.payload ?? {},
    status: "pending",
    attempts: 0,
    maxAttempts: registry[kind].maxAttempts,
    runAt: opts.runAt ?? now(),
    createdAt: now(),
  };
  db.insert(jobs).values(row).run();
  return id;
}

/**
 * Materialize the next occurrence of a recurring `kind`, unless one is
 * already pending or running (so a slow/retrying job doesn't pile up
 * duplicates).
 */
function scheduleNext(
  db: DB,
  kind: JobKind,
  registry: JobRegistry,
  schedules: Partial<Record<JobKind, ScheduleConfig>>,
  nowMs: number,
  random: () => number,
  now: () => string,
): void {
  const schedule = schedules[kind];
  if (!schedule) return;

  const existing = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.kind, kind), inArray(jobs.status, ["pending", "running"])))
    .all();
  if (existing.length > 0) return;

  const delay = jitter(schedule.intervalMs, schedule.jitterPct, random);
  enqueueJob(db, kind, registry, {
    runAt: new Date(nowMs + delay).toISOString(),
    now,
  });
}

/**
 * Bootstrap a cold `jobs` table: for each scheduled kind with no job row at
 * all (any status), enqueue an immediately-due pending job. Without this,
 * `scheduleNext` (which only fires when an existing job of that kind
 * completes) would never start the very first run of a recurring schedule.
 */
export function seedSchedules(
  db: DB,
  registry: JobRegistry,
  schedules: Partial<Record<JobKind, ScheduleConfig>>,
  opts: { now?: () => string } = {},
): void {
  const now = opts.now ?? (() => new Date().toISOString());
  for (const kind of Object.keys(schedules) as JobKind[]) {
    const existing = db.select().from(jobs).where(eq(jobs.kind, kind)).get();
    if (!existing) enqueueJob(db, kind, registry, { runAt: now(), now });
  }
}

/**
 * Claim and run every due pending job, then materialize the next occurrence
 * of any recurring schedules. A failing job is retried with exponential
 * backoff (jittered +/-15%) until `maxAttempts`, after which it is marked
 * "dead". `startMs` (captured before `run` is invoked) is the basis for both
 * the retry's `runAt` and `scheduleNext`'s `nowMs`, so an injected `sleep`
 * used for the per-job timeout race doesn't skew either calculation.
 */
export async function tick(
  db: DB,
  registry: JobRegistry,
  opts: TickOptions = {},
): Promise<TickResult> {
  const {
    clock = Date.now,
    sleep = defaultSleep,
    random = Math.random,
    schedules = {},
    kinds,
    ctx: ctxOverrides = {},
  } = opts;

  const now = () => new Date(clock()).toISOString();
  const result: TickResult = { claimed: 0, ok: 0, failed: 0, dead: 0 };

  const due = db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "pending"),
        lte(jobs.runAt, now()),
        kinds && kinds.length ? inArray(jobs.kind, kinds) : undefined,
      ),
    )
    .orderBy(asc(jobs.runAt))
    .all();

  for (const job of due) {
    result.claimed++;
    const startMs = clock();
    const startedAt = new Date(startMs).toISOString();
    db.update(jobs).set({ status: "running", startedAt }).where(eq(jobs.id, job.id)).run();

    const kind = job.kind as JobKind;
    const def = registry[kind];
    const ctx: JobContext = {
      db,
      config: ctxOverrides.config ?? parseConfig({}),
      env: ctxOverrides.env ?? process.env,
      signal: ctxOverrides.signal,
      connectors: ctxOverrides.connectors,
      fetchImpl: ctxOverrides.fetchImpl,
    };

    try {
      await Promise.race([def.run(job.payload, ctx), timeoutAfter(def.timeoutMs, sleep)]);

      const finishedAt = now();
      db.update(jobs).set({ status: "ok", finishedAt }).where(eq(jobs.id, job.id)).run();

      const run: NewJobRunRow = {
        id: randomUUID(),
        jobId: job.id,
        kind: job.kind,
        attempt: job.attempts + 1,
        status: "ok",
        startedAt,
        finishedAt,
        durationMs: clock() - startMs,
      };
      db.insert(jobRuns).values(run).run();
      result.ok++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const finishedAt = now();
      const attempts = job.attempts + 1;

      const run: NewJobRunRow = {
        id: randomUUID(),
        jobId: job.id,
        kind: job.kind,
        attempt: attempts,
        status: "failed",
        startedAt,
        finishedAt,
        durationMs: clock() - startMs,
        error: message,
      };
      db.insert(jobRuns).values(run).run();

      if (attempts < job.maxAttempts) {
        const delay = jitter(def.backoffBaseMs * 2 ** (attempts - 1), 0.15, random);
        db.update(jobs)
          .set({
            status: "pending",
            attempts,
            runAt: new Date(startMs + delay).toISOString(),
            lastError: message,
          })
          .where(eq(jobs.id, job.id))
          .run();
        result.failed++;
      } else {
        db.update(jobs)
          .set({ status: "dead", attempts, finishedAt, lastError: message })
          .where(eq(jobs.id, job.id))
          .run();
        result.dead++;
      }
    }

    scheduleNext(db, kind, registry, schedules, startMs, random, now);
  }

  return result;
}
