import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { researchCache } from "@/db/schema";
import type { ResearchReport } from "./last30days";

/** Default freshness window for a cached research pull (6 hours). */
export const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase();
}

/** Return a cached report for `topic` if one exists and is within `ttlMs`. */
export function getCachedReport(
  db: DB,
  topic: string,
  ttlMs: number,
  now = Date.now(),
): ResearchReport | null {
  const row = db
    .select()
    .from(researchCache)
    .where(eq(researchCache.topic, normalizeTopic(topic)))
    .get();
  if (!row) return null;
  const age = now - Date.parse(row.createdAt);
  if (!Number.isFinite(age) || age > ttlMs) return null;
  return row.report as unknown as ResearchReport;
}

/** Upsert a fresh report for `topic`. */
export function putCachedReport(
  db: DB,
  topic: string,
  report: ResearchReport,
  nowIso: string,
): void {
  const value = report as unknown as Record<string, unknown>;
  db.insert(researchCache)
    .values({ topic: normalizeTopic(topic), report: value, createdAt: nowIso })
    .onConflictDoUpdate({
      target: researchCache.topic,
      set: { report: value, createdAt: nowIso },
    })
    .run();
}

/**
 * Return a fresh-enough cached report, else run `fetchReport`, cache it, and
 * return it. Lets a re-run within the TTL skip the slow last30days CLI.
 */
export async function cachedResearchReport(
  db: DB,
  topic: string,
  fetchReport: () => Promise<ResearchReport>,
  opts: { ttlMs?: number; now?: () => number; nowIso?: () => string } = {},
): Promise<ResearchReport> {
  const ttlMs = opts.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = opts.now ?? Date.now;
  const cached = getCachedReport(db, topic, ttlMs, now());
  if (cached) return cached;
  const fresh = await fetchReport();
  const nowIso = opts.nowIso ?? (() => new Date().toISOString());
  putCachedReport(db, topic, fresh, nowIso());
  return fresh;
}
