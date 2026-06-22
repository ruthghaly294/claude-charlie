import { describe, it, expect, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { jobs, jobRuns } from "@/db/schema";
import { parseConfig } from "@/discovery/config";
import { buildRegistry, type JobContext } from "./registry";
import { tick, enqueueJob, seedSchedules } from "./runner";

/** Mutable clock + sleep that advances the clock by the slept amount. */
function fakeClock(start = 0) {
  let now = start;
  return {
    clock: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    advance: (ms: number) => (now += ms),
  };
}

describe("enqueueJob", () => {
  it("inserts a pending job with maxAttempts taken from the registry", () => {
    const db = createDb(":memory:");
    const registry = buildRegistry();
    const id = enqueueJob(db, "decode", registry);
    const row = db.select().from(jobs).where(eq(jobs.id, id)).get();
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(0);
    expect(row?.maxAttempts).toBe(registry.decode.maxAttempts);
  });
});

describe("tick kinds filter", () => {
  it("only claims jobs of the given kinds (leaves others pending)", async () => {
    const db = createDb(":memory:");
    const trendRun = vi.fn(async () => {});
    const decodeRun = vi.fn(async () => {});
    const registry = buildRegistry({
      "trend-imitation": { kind: "trend-imitation", run: trendRun, maxAttempts: 1, backoffBaseMs: 1, timeoutMs: 1000 },
      decode: { kind: "decode", run: decodeRun, maxAttempts: 1, backoffBaseMs: 1, timeoutMs: 1000 },
    });
    const at = () => new Date(0).toISOString();
    const trendId = enqueueJob(db, "trend-imitation", registry, { runAt: at(), now: at, payload: { runId: "r1", topic: "t" } });
    const decodeId = enqueueJob(db, "decode", registry, { runAt: at(), now: at });

    const result = await tick(db, registry, { clock: () => 0, kinds: ["trend-imitation"] });

    expect(result.claimed).toBe(1);
    expect(trendRun).toHaveBeenCalledTimes(1);
    expect(decodeRun).not.toHaveBeenCalled();
    expect(db.select().from(jobs).where(eq(jobs.id, trendId)).get()?.status).toBe("ok");
    expect(db.select().from(jobs).where(eq(jobs.id, decodeId)).get()?.status).toBe("pending");
  });
});

describe("tick", () => {
  it("claims a due pending job, runs it, and marks it ok with a job_runs log", async () => {
    const db = createDb(":memory:");
    const registry = buildRegistry({
      discovery: {
        kind: "discovery",
        run: async () => {},
        maxAttempts: 3,
        backoffBaseMs: 1000,
        timeoutMs: 1000,
      },
    });
    const jobId = enqueueJob(db, "discovery", registry, {
      runAt: new Date(0).toISOString(),
      now: () => new Date(0).toISOString(),
    });

    const result = await tick(db, registry, { clock: () => 0 });
    expect(result).toEqual({ claimed: 1, ok: 1, failed: 0, dead: 0 });

    const row = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    expect(row?.status).toBe("ok");
    expect(row?.startedAt).toBeTruthy();
    expect(row?.finishedAt).toBeTruthy();

    const runRow = db.select().from(jobRuns).get();
    expect(runRow?.status).toBe("ok");
    expect(runRow?.attempt).toBe(1);
    expect(runRow?.jobId).toBe(jobId);
    expect(runRow?.kind).toBe("discovery");
  });

  it("does not claim a pending job whose runAt is in the future", async () => {
    const db = createDb(":memory:");
    const registry = buildRegistry({
      discovery: {
        kind: "discovery",
        run: async () => {},
        maxAttempts: 3,
        backoffBaseMs: 1000,
        timeoutMs: 1000,
      },
    });
    enqueueJob(db, "discovery", registry, {
      runAt: new Date(60_000).toISOString(),
      now: () => new Date(0).toISOString(),
    });

    const result = await tick(db, registry, { clock: () => 0 });
    expect(result).toEqual({ claimed: 0, ok: 0, failed: 0, dead: 0 });
    expect(db.select().from(jobs).get()?.status).toBe("pending");
  });

  it("retries a failing job with exponential backoff, then marks it dead at maxAttempts", async () => {
    const { clock, sleep, advance } = fakeClock(0);
    const db = createDb(":memory:");
    const registry = buildRegistry({
      discovery: {
        kind: "discovery",
        run: async () => {
          throw new Error("boom");
        },
        maxAttempts: 2,
        backoffBaseMs: 1000,
        timeoutMs: 1000,
      },
    });
    const jobId = enqueueJob(db, "discovery", registry, {
      runAt: new Date(0).toISOString(),
      now: () => new Date(clock()).toISOString(),
    });

    // random=0.5 -> zero jitter, so the backoff is exactly backoffBaseMs * 2^(attempt-1)
    const first = await tick(db, registry, { clock, sleep, random: () => 0.5 });
    expect(first).toEqual({ claimed: 1, ok: 0, failed: 1, dead: 0 });

    let row = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toContain("boom");
    expect(row?.runAt).toBe(new Date(1000).toISOString());

    advance(1000); // now == runAt of the retry
    const second = await tick(db, registry, { clock, sleep, random: () => 0.5 });
    expect(second).toEqual({ claimed: 1, ok: 0, failed: 0, dead: 1 });

    row = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    expect(row?.status).toBe("dead");
    expect(row?.attempts).toBe(2);

    const runs = db.select().from(jobRuns).orderBy(asc(jobRuns.attempt)).all();
    expect(runs.map((r) => r.attempt)).toEqual([1, 2]);
    expect(runs.every((r) => r.status === "failed")).toBe(true);
  });

  it("times out a hanging job within its timeout budget and records the failure", async () => {
    const db = createDb(":memory:");
    const registry = buildRegistry({
      discovery: {
        kind: "discovery",
        run: () => new Promise<never>(() => {}),
        maxAttempts: 1,
        backoffBaseMs: 1000,
        timeoutMs: 30,
      },
    });
    enqueueJob(db, "discovery", registry, {
      runAt: new Date(0).toISOString(),
      now: () => new Date(0).toISOString(),
    });

    const start = Date.now();
    const result = await tick(db, registry, { clock: () => 0 });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result.dead).toBe(1);

    const row = db.select().from(jobs).get();
    expect(row?.status).toBe("dead");
    expect(row?.lastError).toContain("timed out");
  });

  it("materializes the next scheduled job on completion, applying jitter", async () => {
    const { clock, sleep } = fakeClock(0);
    const db = createDb(":memory:");
    const registry = buildRegistry({
      discovery: {
        kind: "discovery",
        run: async () => {},
        maxAttempts: 3,
        backoffBaseMs: 1000,
        timeoutMs: 1000,
      },
    });
    enqueueJob(db, "discovery", registry, {
      runAt: new Date(0).toISOString(),
      now: () => new Date(0).toISOString(),
    });

    await tick(db, registry, {
      clock,
      sleep,
      random: () => 0.5, // zero jitter
      schedules: { discovery: { intervalMs: 60_000, jitterPct: 0.1 } },
    });

    const rows = db.select().from(jobs).all();
    expect(rows).toHaveLength(2);
    const next = rows.find((r) => r.status === "pending");
    expect(next?.runAt).toBe(new Date(60_000).toISOString());
    expect(next?.maxAttempts).toBe(registry.discovery.maxAttempts);
  });

  it("does not double-schedule while a pending/running job of that kind already exists", async () => {
    const { clock, sleep } = fakeClock(0);
    const db = createDb(":memory:");
    const registry = buildRegistry({
      discovery: {
        kind: "discovery",
        run: async () => {},
        maxAttempts: 3,
        backoffBaseMs: 1000,
        timeoutMs: 1000,
      },
    });
    enqueueJob(db, "discovery", registry, {
      runAt: new Date(0).toISOString(),
      now: () => new Date(0).toISOString(),
    });

    const schedules = { discovery: { intervalMs: 60_000, jitterPct: 0 } };
    await tick(db, registry, { clock, sleep, schedules });
    // the freshly-scheduled job isn't due yet, so this tick claims nothing
    await tick(db, registry, { clock, sleep, schedules });

    expect(db.select().from(jobs).all()).toHaveLength(2);
  });

  it("passes the configured ctx (config/env) through to the job's run function", async () => {
    const db = createDb(":memory:");
    let seen: JobContext | undefined;
    const registry = buildRegistry({
      discovery: {
        kind: "discovery",
        run: async (_payload, ctx) => {
          seen = ctx;
        },
        maxAttempts: 1,
        backoffBaseMs: 1000,
        timeoutMs: 1000,
      },
    });
    enqueueJob(db, "discovery", registry, {
      runAt: new Date(0).toISOString(),
      now: () => new Date(0).toISOString(),
    });

    const config = { ...parseConfig({}), businessName: "Test Co" };
    await tick(db, registry, { clock: () => 0, ctx: { config, env: { FOO: "1" } } });

    expect(seen?.config.businessName).toBe("Test Co");
    expect(seen?.env.FOO).toBe("1");
    expect(seen?.db).toBe(db);
  });
});

describe("seedSchedules", () => {
  it("enqueues a due pending job for each scheduled kind with no existing job row", () => {
    const db = createDb(":memory:");
    const registry = buildRegistry();
    seedSchedules(
      db,
      registry,
      { decode: { intervalMs: 60_000, jitterPct: 0.1 } },
      { now: () => new Date(0).toISOString() },
    );

    const rows = db.select().from(jobs).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("decode");
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.runAt).toBe(new Date(0).toISOString());
    expect(rows[0]?.maxAttempts).toBe(registry.decode.maxAttempts);
  });

  it("does not seed a kind that already has a job row", () => {
    const db = createDb(":memory:");
    const registry = buildRegistry();
    enqueueJob(db, "decode", registry, { now: () => new Date(0).toISOString() });

    seedSchedules(
      db,
      registry,
      { decode: { intervalMs: 60_000, jitterPct: 0.1 } },
      { now: () => new Date(1000).toISOString() },
    );

    expect(db.select().from(jobs).all()).toHaveLength(1);
  });
});
