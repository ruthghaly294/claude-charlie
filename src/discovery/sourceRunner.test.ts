import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { sourceHealth } from "@/db/schema";
import { parseConfig, type DecodeConfig } from "./config";
import type { Connector, ConnectorState, RawSignal } from "./types";
import { runSources } from "./sourceRunner";

function fake(
  key: string,
  out: RawSignal[],
  opts: {
    behavior?: "ok" | "throw" | "skip" | "hang";
    healthCheck?: (ctx: unknown) => Promise<ConnectorState>;
    onFetch?: () => void;
  } = {},
): Connector {
  const { behavior = "ok", healthCheck, onFetch } = opts;
  return {
    key,
    label: key,
    requiresKeys: [],
    state: () =>
      behavior === "skip" ? { configured: false, reason: "off" } : { configured: true },
    healthCheck,
    fetch: async () => {
      onFetch?.();
      if (behavior === "throw") throw new Error("boom");
      if (behavior === "hang") return new Promise<never>(() => {});
      return out;
    },
  } as Connector;
}

const sig = (over: Partial<RawSignal>): RawSignal => ({
  source: "src",
  title: "t",
  url: "https://x/1",
  author: "",
  publishedAt: "",
  tags: [],
  raw: "",
  ...over,
});

function cfg(over: Partial<DecodeConfig["robustness"]> = {}): DecodeConfig {
  const base = parseConfig({});
  return { ...base, robustness: { ...base.robustness, ...over } };
}

/** Mutable clock + sleep that advances the clock by the slept amount, for breaker cooldown tests. */
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

describe("runSources", () => {
  it("runs connectors and returns ok results with their signals", async () => {
    const db = createDb(":memory:");
    const conns = [fake("rss", [sig({ url: "https://x/1", title: "one" })])];
    const { perSource, collected } = await runSources(db, cfg(), conns);
    expect(perSource).toEqual([
      { source: "rss", status: "ok", found: 1, added: 0, durationMs: expect.any(Number) },
    ]);
    expect(collected).toHaveLength(1);
    expect(collected[0]?.source).toBe("rss"); // normalised to the connector key
  });

  it("marks unconfigured connectors as skipped without touching source_health", async () => {
    const db = createDb(":memory:");
    const conns = [fake("twitter", [], { behavior: "skip" })];
    const { perSource } = await runSources(db, cfg(), conns);
    expect(perSource[0]).toEqual({
      source: "twitter",
      status: "skipped",
      found: 0,
      added: 0,
      durationMs: 0,
      error: "off",
    });
    expect(db.select().from(sourceHealth).where(eq(sourceHealth.source, "twitter")).all()).toHaveLength(0);
  });

  it("isolates a throwing connector and records the failure in source_health", async () => {
    const db = createDb(":memory:");
    const conns = [fake("bad", [], { behavior: "throw" })];
    const { perSource } = await runSources(db, cfg(), conns);
    expect(perSource[0]?.status).toBe("error");
    expect(perSource[0]?.error).toContain("boom");

    const health = db.select().from(sourceHealth).where(eq(sourceHealth.source, "bad")).get();
    expect(health?.consecutiveFailures).toBe(1);
    expect(health?.totalRuns).toBe(1);
    expect(health?.totalFailures).toBe(1);
    expect(health?.state).toBe("closed"); // default threshold is 3
    expect(health?.lastError).toContain("boom");
  });

  it("times out a hanging connector within its per-source budget and marks it error", async () => {
    const db = createDb(":memory:");
    const conns = [fake("slow", [], { behavior: "hang" })];
    const start = Date.now();
    const { perSource } = await runSources(db, cfg({ perSourceTimeoutMs: 30 }), conns);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(perSource[0]?.status).toBe("error");
    expect(perSource[0]?.error).toContain("timed out");
  });

  it("fences a connector behind healthCheck without affecting the circuit breaker", async () => {
    const db = createDb(":memory:");
    let fetchCalled = false;
    const conns = [
      fake("twitter", [sig({})], {
        healthCheck: async () => ({ configured: false, reason: "TWITTER_BEARER unauthorized (401)" }),
        onFetch: () => {
          fetchCalled = true;
        },
      }),
    ];
    const { perSource } = await runSources(db, cfg(), conns);
    expect(perSource[0]).toEqual({
      source: "twitter",
      status: "skipped",
      found: 0,
      added: 0,
      durationMs: 0,
      error: "TWITTER_BEARER unauthorized (401)",
    });
    expect(fetchCalled).toBe(false);
    expect(db.select().from(sourceHealth).where(eq(sourceHealth.source, "twitter")).all()).toHaveLength(0);
  });

  it("opens the circuit breaker after consecutive failures and skips on the next run until cooldown elapses", async () => {
    const { clock, sleep, advance } = fakeClock(1_000_000);
    const db = createDb(":memory:");
    const config = cfg({ breaker: { failureThreshold: 1, cooldownMs: 5000 } });

    let calls = 0;
    const conns = [
      fake("flaky", [sig({ url: "https://x/ok" })], {
        behavior: "throw",
        onFetch: () => {
          calls++;
        },
      }),
    ];
    // first run fails -> breaker opens
    const first = await runSources(db, config, conns, { clock, sleep });
    expect(first.perSource[0]?.status).toBe("error");
    expect(calls).toBe(1);

    const health = db.select().from(sourceHealth).where(eq(sourceHealth.source, "flaky")).get();
    expect(health?.state).toBe("open");

    // second run, still within cooldown -> skipped, connector never called again
    const second = await runSources(db, config, conns, { clock, sleep });
    expect(second.perSource[0]?.status).toBe("skipped");
    expect(second.perSource[0]?.error).toContain("circuit breaker open");
    expect(calls).toBe(1);

    // advance past the cooldown -> half-open trial runs again
    advance(5001);
    const third = await runSources(db, config, conns, { clock, sleep });
    expect(third.perSource[0]?.status).toBe("error"); // still throws, but it *ran*
    expect(calls).toBe(2);
  });

  it("recovers a circuit breaker to closed once a half-open trial succeeds", async () => {
    const { clock, sleep, advance } = fakeClock(2_000_000);
    const db = createDb(":memory:");
    const config = cfg({ breaker: { failureThreshold: 1, cooldownMs: 1000 } });

    const failing = [fake("flaky", [], { behavior: "throw" })];
    await runSources(db, config, failing, { clock, sleep }); // opens breaker

    advance(1001); // past cooldown -> half-open

    const succeeding = [fake("flaky", [sig({ url: "https://x/ok" })])];
    const result = await runSources(db, config, succeeding, { clock, sleep });
    expect(result.perSource[0]?.status).toBe("ok");

    const health = db.select().from(sourceHealth).where(eq(sourceHealth.source, "flaky")).get();
    expect(health?.state).toBe("closed");
    expect(health?.consecutiveFailures).toBe(0);
  });

  it("caps concurrent connector fetches at max_parallel_sources", async () => {
    const db = createDb(":memory:");
    let active = 0;
    let maxActive = 0;
    const conns = Array.from({ length: 5 }, (_, i) =>
      fake(`c${i}`, [], {
        onFetch: () => {},
      }),
    ).map((c) => ({
      ...c,
      fetch: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
        return [];
      },
    }));
    await runSources(db, cfg({ maxParallelSources: 2 }), conns);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
