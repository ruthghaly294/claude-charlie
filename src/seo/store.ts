import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  seoAudits,
  seoPages,
  seoRankings,
  seoRecommendations,
  seoSites,
  seoTrends,
  type NewSeoPage,
  type NewSeoRanking,
  type NewSeoTrend,
  type SeoAudit,
  type SeoRanking,
  type SeoRecommendation,
  type SeoScores,
  type SeoSite,
} from "@/db/schema";

export type SiteInput = {
  id?: string;
  label?: string;
  domain: string;
  competitors?: string[];
  keywords?: string[];
  maxPages?: number;
};

function slugId(domain: string): string {
  return (
    domain
      .replace(/^https?:\/\//, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || randomUUID()
  );
}

/** Upsert a tracked site by id (or a domain-derived slug); returns the row. */
export function upsertSite(
  db: DB,
  input: SiteInput,
  now: () => string = () => new Date().toISOString(),
): SeoSite {
  const id = input.id ?? slugId(input.domain);
  const existing = db.select().from(seoSites).where(eq(seoSites.id, id)).get();
  const row: SeoSite = {
    id,
    label: input.label ?? existing?.label ?? input.domain,
    domain: input.domain,
    competitors: input.competitors ?? existing?.competitors ?? [],
    keywords: input.keywords ?? existing?.keywords ?? [],
    maxPages: input.maxPages ?? existing?.maxPages ?? 40,
    createdAt: existing?.createdAt ?? now(),
  };
  db.insert(seoSites)
    .values(row)
    .onConflictDoUpdate({
      target: seoSites.id,
      set: {
        label: row.label,
        domain: row.domain,
        competitors: row.competitors,
        keywords: row.keywords,
        maxPages: row.maxPages,
      },
    })
    .run();
  return row;
}

export function getSite(db: DB, id: string): SeoSite | undefined {
  return db.select().from(seoSites).where(eq(seoSites.id, id)).get();
}

export function listSites(db: DB): SeoSite[] {
  return db.select().from(seoSites).orderBy(desc(seoSites.createdAt)).all();
}

export function startAudit(
  db: DB,
  siteId: string,
  now: () => string = () => new Date().toISOString(),
): string {
  const id = randomUUID();
  db.insert(seoAudits)
    .values({ id, siteId, startedAt: now(), status: "running" })
    .run();
  return id;
}

export function finishAudit(
  db: DB,
  auditId: string,
  patch: {
    status: SeoAudit["status"];
    scores?: SeoScores;
    summary?: string;
    newRecCount?: number;
    error?: string;
  },
  now: () => string = () => new Date().toISOString(),
): void {
  db.update(seoAudits)
    .set({
      finishedAt: now(),
      status: patch.status,
      scores: patch.scores,
      summary: patch.summary ?? "",
      newRecCount: patch.newRecCount ?? 0,
      error: patch.error,
    })
    .where(eq(seoAudits.id, auditId))
    .run();
}

export function latestAudit(db: DB, siteId: string): SeoAudit | undefined {
  return db
    .select()
    .from(seoAudits)
    .where(eq(seoAudits.siteId, siteId))
    .orderBy(desc(seoAudits.startedAt))
    .get();
}

export function insertPages(db: DB, pages: NewSeoPage[]): void {
  if (pages.length === 0) return;
  db.insert(seoPages).values(pages).run();
}

export function insertTrends(db: DB, trends: NewSeoTrend[]): void {
  if (trends.length === 0) return;
  db.insert(seoTrends).values(trends).run();
}

export function insertRankings(db: DB, rankings: NewSeoRanking[]): void {
  if (rankings.length === 0) return;
  db.insert(seoRankings).values(rankings).run();
}

/** Most recent ranking row per keyword for a site (for the dashboard table). */
export function latestRankings(db: DB, siteId: string): SeoRanking[] {
  const rows = db
    .select()
    .from(seoRankings)
    .where(eq(seoRankings.siteId, siteId))
    .orderBy(desc(seoRankings.capturedAt))
    .all();
  const byKeyword = new Map<string, SeoRanking>();
  for (const r of rows) if (!byKeyword.has(r.keyword)) byKeyword.set(r.keyword, r);
  return [...byKeyword.values()];
}

export type RecommendationView = SeoRecommendation & { isNew: boolean };

/**
 * Open recommendations for a site, newest-first, each flagged `isNew` when it
 * was first seen in the given audit — this is what powers the dashboard's NEW
 * badge ("things you should do that you haven't done yet, freshly surfaced").
 */
export function openRecommendations(
  db: DB,
  siteId: string,
  latestAuditId?: string,
): RecommendationView[] {
  const rows = db
    .select()
    .from(seoRecommendations)
    .where(
      and(
        eq(seoRecommendations.siteId, siteId),
        eq(seoRecommendations.status, "open"),
      ),
    )
    .orderBy(desc(seoRecommendations.lastSeenAt))
    .all();
  return rows.map((r) => ({
    ...r,
    isNew: latestAuditId !== undefined && r.firstSeenAuditId === latestAuditId,
  }));
}

export function setRecommendationStatus(
  db: DB,
  id: string,
  status: SeoRecommendation["status"],
  now: () => string = () => new Date().toISOString(),
): void {
  db.update(seoRecommendations)
    .set({ status, doneAt: status === "done" ? now() : null })
    .where(eq(seoRecommendations.id, id))
    .run();
}
