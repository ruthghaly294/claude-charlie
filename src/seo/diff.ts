import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { seoRecommendations } from "@/db/schema";
import type { RecommendationDraft } from "./types";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Stable identity for a recommendation across runs. Two audits that surface the
 * "same" gap produce the same fingerprint, so the diff can tell genuinely-new
 * to-dos from ones already on the list (or already resolved).
 */
export function fingerprint(siteId: string, draft: RecommendationDraft): string {
  const key = [siteId, draft.category, normalize(draft.title), draft.targetUrl ?? ""].join("|");
  return createHash("sha1").update(key).digest("hex");
}

export type DiffResult = {
  total: number;
  created: number;
  updated: number;
  autoResolved: number;
};

/**
 * Upsert this audit's recommendation drafts against the durable list by
 * fingerprint:
 *  - unseen fingerprint → insert as a NEW open to-do (firstSeen = this audit)
 *  - already-open fingerprint → refresh content, mark seen, reset missed counter
 *  - done/dismissed fingerprint → left resolved (never re-nag)
 * Open recs not present this run accrue a missed-run counter and auto-resolve
 * after `autoResolveAfterRuns`, so fixed issues drop off without a manual click.
 */
export function applyRecommendations(
  db: DB,
  siteId: string,
  auditId: string,
  drafts: RecommendationDraft[],
  opts: { now?: () => string; autoResolveAfterRuns?: number } = {},
): DiffResult {
  const now = opts.now ?? (() => new Date().toISOString());
  const autoResolveAfterRuns = opts.autoResolveAfterRuns ?? 3;
  const ts = now();

  let created = 0;
  let updated = 0;
  const seen: string[] = [];

  for (const draft of drafts) {
    const fp = fingerprint(siteId, draft);
    seen.push(fp);
    const existing = db
      .select()
      .from(seoRecommendations)
      .where(eq(seoRecommendations.fingerprint, fp))
      .get();

    if (!existing) {
      db.insert(seoRecommendations)
        .values({
          id: randomUUID(),
          siteId,
          fingerprint: fp,
          category: draft.category,
          title: draft.title,
          detail: draft.detail,
          executionSteps: draft.executionSteps,
          impact: draft.impact,
          effort: draft.effort,
          evidence: draft.evidence,
          status: "open",
          firstSeenAuditId: auditId,
          lastSeenAuditId: auditId,
          firstSeenAt: ts,
          lastSeenAt: ts,
          missedRuns: 0,
        })
        .run();
      created++;
      continue;
    }

    if (existing.status === "open" || existing.status === "reopened") {
      db.update(seoRecommendations)
        .set({
          detail: draft.detail,
          executionSteps: draft.executionSteps,
          impact: draft.impact,
          effort: draft.effort,
          evidence: draft.evidence,
          lastSeenAuditId: auditId,
          lastSeenAt: ts,
          missedRuns: 0,
        })
        .where(eq(seoRecommendations.id, existing.id))
        .run();
      updated++;
    }
  }

  const autoResolved = resolveMissing(db, siteId, seen, autoResolveAfterRuns, ts);

  return { total: drafts.length, created, updated, autoResolved };
}

function resolveMissing(
  db: DB,
  siteId: string,
  seen: string[],
  threshold: number,
  ts: string,
): number {
  const openRows = db
    .select()
    .from(seoRecommendations)
    .where(
      and(
        eq(seoRecommendations.siteId, siteId),
        inArray(seoRecommendations.status, ["open", "reopened"]),
        seen.length > 0
          ? notInArray(seoRecommendations.fingerprint, seen)
          : undefined,
      ),
    )
    .all();

  let autoResolved = 0;
  for (const row of openRows) {
    const missed = row.missedRuns + 1;
    if (missed >= threshold) {
      db.update(seoRecommendations)
        .set({ status: "done", doneAt: ts, missedRuns: missed })
        .where(eq(seoRecommendations.id, row.id))
        .run();
      autoResolved++;
    } else {
      db.update(seoRecommendations)
        .set({ missedRuns: missed })
        .where(eq(seoRecommendations.id, row.id))
        .run();
    }
  }
  return autoResolved;
}
