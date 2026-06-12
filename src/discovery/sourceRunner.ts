import { inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  sourceHealth,
  type SourceRunResult,
  type SourceHealthRow,
  type NewSourceHealthRow,
} from "@/db/schema";
import type { Connector, ConnectorContext, RawSignal } from "./types";
import { parseRawSignals } from "./types";
import type { DecodeConfig } from "./config";
import { CircuitBreaker, type BreakerRecord } from "../lib/circuitBreaker";
import { RateLimiter, domainOf } from "../lib/rateLimiter";

export type SourceRunnerOptions = {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  /** injectable clock (ms), defaults to Date.now */
  clock?: () => number;
  /** injectable sleep, defaults to a real setTimeout-based wait */
  sleep?: (ms: number) => Promise<void>;
};

export type SourceRunOutput = {
  perSource: SourceRunResult[];
  collected: RawSignal[];
};

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

function timeoutAfter(
  ms: number,
  sleep: (ms: number) => Promise<void>,
): Promise<never> {
  return sleep(ms).then(() => {
    throw new Error(`source timed out after ${ms}ms`);
  });
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Run `fn` over `items` with at most `limit` concurrent invocations. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]!);
      }
    }),
  );
  return results;
}

function breakerRecordFromRow(row: SourceHealthRow): BreakerRecord {
  return {
    state: row.state,
    consecutiveFailures: row.consecutiveFailures,
    openUntil: row.openUntil ? Date.parse(row.openUntil) : null,
  };
}

function skipped(source: string, reason?: string): SourceRunResult {
  return {
    source,
    status: "skipped",
    found: 0,
    added: 0,
    durationMs: 0,
    error: reason,
  };
}

function buildHealthRow(
  key: string,
  prev: SourceHealthRow | undefined,
  breaker: CircuitBreaker,
  now: string,
  durationMs: number,
  success: boolean,
  errorMessage?: string,
): NewSourceHealthRow {
  const rec = breaker.getRecord(key);
  const prevAvg = prev?.avgLatencyMs ?? 0;
  return {
    source: key,
    state: rec.state,
    consecutiveFailures: rec.consecutiveFailures,
    openUntil: rec.openUntil !== null ? new Date(rec.openUntil).toISOString() : null,
    lastSuccessAt: success ? now : prev?.lastSuccessAt ?? null,
    lastErrorAt: success ? prev?.lastErrorAt ?? null : now,
    lastError: success ? (prev?.lastError ?? null) : (errorMessage ?? null),
    avgLatencyMs: prevAvg === 0 ? durationMs : prevAvg * 0.7 + durationMs * 0.3,
    totalRuns: (prev?.totalRuns ?? 0) + 1,
    totalFailures: (prev?.totalFailures ?? 0) + (success ? 0 : 1),
    updatedAt: now,
  };
}

/**
 * Fan out across `connectors` (up to `config.robustness.maxParallelSources`
 * concurrently). Each gets its own per-source timeout budget
 * (`per_source_timeout_ms`, enforced via both an AbortSignal and a
 * Promise.race so even a connector that ignores the signal can't hang the
 * run), a `fetchImpl` rate-limited per target domain (src/lib/rateLimiter.ts),
 * and is gated by a circuit breaker (src/lib/circuitBreaker.ts) persisted to
 * the `source_health` table so a repeatedly-failing source is skipped rather
 * than retried every run. Returns the same shape the old serial loop
 * produced — downstream dedup/scoring is untouched.
 */
export async function runSources(
  db: DB,
  config: DecodeConfig,
  connectors: Connector[],
  opts: SourceRunnerOptions = {},
): Promise<SourceRunOutput> {
  const {
    fetchImpl = fetch,
    env = process.env,
    signal,
    clock = Date.now,
    sleep = defaultSleep,
  } = opts;

  const {
    perSourceTimeoutMs,
    maxParallelSources,
    breaker: breakerCfg,
    rateLimits,
  } = config.robustness;

  const keys = connectors.map((c) => c.key);
  const existingHealth =
    keys.length > 0
      ? db.select().from(sourceHealth).where(inArray(sourceHealth.source, keys)).all()
      : [];
  const healthByKey = new Map(existingHealth.map((r) => [r.source, r]));

  const initialRecords: Record<string, BreakerRecord> = {};
  for (const row of existingHealth) {
    initialRecords[row.source] = breakerRecordFromRow(row);
  }

  const breaker = new CircuitBreaker(
    { failureThreshold: breakerCfg.failureThreshold, cooldownMs: breakerCfg.cooldownMs, clock },
    initialRecords,
  );
  const limiter = new RateLimiter(rateLimits, { clock, sleep });

  const wrappedFetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => limiter.schedule(domainOf(requestUrl(input)), () => fetchImpl(input, init))) as typeof fetch;

  const healthUpdates: NewSourceHealthRow[] = [];

  const outputs = await mapWithConcurrency(connectors, maxParallelSources, async (connector) => {
    const key = connector.key;
    const timeout = AbortSignal.timeout(perSourceTimeoutMs);
    const composedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

    const ctx: ConnectorContext = {
      keywords: config.keywords,
      businessName: config.businessName,
      config: config.sources[key],
      env,
      fetchImpl: wrappedFetch,
      signal: composedSignal,
    };

    const st = connector.state(ctx);
    if (!st.configured) {
      return { result: skipped(key, st.reason), signals: [] as RawSignal[] };
    }

    if (!breaker.canRun(key)) {
      const openUntil = breaker.getRecord(key).openUntil;
      const until = openUntil ? new Date(openUntil).toISOString() : "unknown";
      return {
        result: skipped(key, `circuit breaker open until ${until}`),
        signals: [] as RawSignal[],
      };
    }

    if (connector.healthCheck) {
      const hc = await connector.healthCheck(ctx);
      if (!hc.configured) {
        return { result: skipped(key, hc.reason), signals: [] as RawSignal[] };
      }
    }

    const started = clock();
    try {
      const raw = await Promise.race([
        connector.fetch(ctx),
        timeoutAfter(perSourceTimeoutMs, sleep),
      ]);
      const valid = parseRawSignals(key, raw as unknown[]);
      const durationMs = clock() - started;
      breaker.recordSuccess(key);
      healthUpdates.push(
        buildHealthRow(key, healthByKey.get(key), breaker, new Date(clock()).toISOString(), durationMs, true),
      );
      return {
        result: { source: key, status: "ok" as const, found: valid.length, added: 0, durationMs },
        signals: valid,
      };
    } catch (err) {
      const durationMs = clock() - started;
      const message = err instanceof Error ? err.message : String(err);
      breaker.recordFailure(key);
      healthUpdates.push(
        buildHealthRow(key, healthByKey.get(key), breaker, new Date(clock()).toISOString(), durationMs, false, message),
      );
      return {
        result: { source: key, status: "error" as const, found: 0, added: 0, durationMs, error: message },
        signals: [] as RawSignal[],
      };
    }
  });

  for (const row of healthUpdates) {
    db.insert(sourceHealth)
      .values(row)
      .onConflictDoUpdate({ target: sourceHealth.source, set: row })
      .run();
  }

  const perSource: SourceRunResult[] = [];
  const collected: RawSignal[] = [];
  for (const { result, signals } of outputs) {
    perSource.push(result);
    collected.push(...signals);
  }
  return { perSource, collected };
}
