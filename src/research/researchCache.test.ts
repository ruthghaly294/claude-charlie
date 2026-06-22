import { describe, it, expect, vi } from "vitest";
import { createDb, type DB } from "@/db/client";
import type { ResearchReport } from "./last30days";
import {
  getCachedReport,
  putCachedReport,
  cachedResearchReport,
} from "./researchCache";

const report = (topic = "ai"): ResearchReport => ({
  topic,
  rangeFrom: "2026-05-16",
  rangeTo: "2026-06-15",
  itemsBySource: { reddit: [] },
  errorsBySource: {},
  warnings: [],
});

describe("researchCache", () => {
  it("stores and returns a fresh report (case-insensitive topic)", () => {
    const db: DB = createDb(":memory:");
    putCachedReport(db, "AI Coding", report("AI Coding"), "2026-06-22T00:00:00.000Z");
    const got = getCachedReport(db, "ai coding", 60_000, Date.parse("2026-06-22T00:00:30.000Z"));
    expect(got?.topic).toBe("AI Coding");
  });

  it("returns null when the cached report is older than the TTL", () => {
    const db: DB = createDb(":memory:");
    putCachedReport(db, "ai", report(), "2026-06-22T00:00:00.000Z");
    const got = getCachedReport(db, "ai", 60_000, Date.parse("2026-06-22T01:00:00.000Z"));
    expect(got).toBeNull();
  });

  it("fetches and caches on a miss, then serves the cache on the next call", async () => {
    const db: DB = createDb(":memory:");
    const fetchReport = vi.fn(async () => report());
    let t = 1000;
    const opts = { ttlMs: 60_000, now: () => t, nowIso: () => new Date(t).toISOString() };

    await cachedResearchReport(db, "ai", fetchReport, opts);
    t = 2000; // still within TTL
    await cachedResearchReport(db, "ai", fetchReport, opts);

    expect(fetchReport).toHaveBeenCalledOnce(); // second call served from cache
  });

  it("re-fetches after the TTL expires", async () => {
    const db: DB = createDb(":memory:");
    const fetchReport = vi.fn(async () => report());
    let t = 1000;
    const opts = { ttlMs: 60_000, now: () => t, nowIso: () => new Date(t).toISOString() };

    await cachedResearchReport(db, "ai", fetchReport, opts);
    t = 1000 + 120_000; // past TTL
    await cachedResearchReport(db, "ai", fetchReport, opts);

    expect(fetchReport).toHaveBeenCalledTimes(2);
  });
});
