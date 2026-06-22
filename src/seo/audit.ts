import { randomUUID } from "node:crypto";
import type { DB } from "@/db/client";
import type { NewSeoPage, NewSeoRanking, NewSeoTrend, SeoSite } from "@/db/schema";
import type { UsageMeter } from "@/discovery/usage";
import { notifyAll, type Notifier } from "@/notify/notifier";
import type { ResearchReport } from "@/research/last30days";
import { crawlSite } from "./crawl";
import { competitorGaps } from "./competitor";
import { applyRecommendations } from "./diff";
import { geoIssuesForPage, geoIssuesForSite } from "./geoChecks";
import { scoreFromIssues, seoIssuesForPage, seoIssuesForSite } from "./seoChecks";
import {
  generateRecommendations,
  type AuditFacts,
  type IssueOnPage,
  type ReasonerClient,
} from "./reasoner";
import { discoverTrendGaps } from "./trendGap";
import { gatherProviderSignals, type SeoDataProvider } from "./providers";
import { finishAudit, insertPages, insertRankings, insertTrends, openRecommendations, startAudit } from "./store";
import type { AuditSummary, CrawlResult, SeoIssue, SeoScores } from "./types";

export type RunAuditDeps = {
  fetchImpl?: typeof fetch;
  reasonerClient?: ReasonerClient | null;
  meter?: UsageMeter;
  providers?: SeoDataProvider[];
  notifiers?: Notifier[];
  env?: Record<string, string | undefined>;
  runResearch?: (topic: string) => Promise<ResearchReport>;
  crawl?: typeof crawlSite;
  now?: () => string;
  signal?: AbortSignal;
  delayMs?: number;
  maxCompetitorPages?: number;
  autoResolveAfterRuns?: number;
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function siteText(crawl: CrawlResult): string {
  return crawl.pages
    .map((p) => p.text)
    .join(" ")
    .slice(0, 20_000);
}

function computeScores(
  pageSeoScores: number[],
  pageGeoScores: number[],
  siteSeoIssues: SeoIssue[],
  siteGeoIssues: SeoIssue[],
  competitorGapCount: number,
): SeoScores {
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 100);
  const seo = clamp(avg(pageSeoScores) - (100 - scoreFromIssues(siteSeoIssues)));
  const geo = clamp(avg(pageGeoScores) - (100 - scoreFromIssues(siteGeoIssues)));
  const competitor = clamp(100 - competitorGapCount * 15);
  const overall = clamp(0.4 * seo + 0.4 * geo + 0.2 * competitor);
  return { seo, geo, competitor, overall };
}

/**
 * Full audit for one site: crawl self + competitors, run on-page SEO/GEO checks,
 * gather provider signals (rank tracking etc.), detect trend & competitor gaps,
 * synthesize recommendations, persist everything, and diff the recommendation
 * list so only genuinely-new to-dos surface. Returns a summary. Every external
 * dependency is injectable, so the whole pipeline runs offline in tests.
 */
export async function runSeoAudit(
  db: DB,
  site: SeoSite,
  deps: RunAuditDeps = {},
): Promise<AuditSummary> {
  const now = deps.now ?? (() => new Date().toISOString());
  const crawl = deps.crawl ?? crawlSite;
  const ts = now();
  const auditId = startAudit(db, site.id, now);

  try {
    const self = await crawl(site.domain, {
      maxPages: site.maxPages,
      fetchImpl: deps.fetchImpl,
      delayMs: deps.delayMs,
      signal: deps.signal,
    });

    const maxCompetitorPages = deps.maxCompetitorPages ?? 5;
    const competitors: CrawlResult[] = [];
    for (const url of site.competitors) {
      competitors.push(
        await crawl(url, {
          maxPages: maxCompetitorPages,
          fetchImpl: deps.fetchImpl,
          delayMs: deps.delayMs,
          signal: deps.signal,
        }),
      );
    }

    const pageRows: NewSeoPage[] = [];
    const pageIssues: IssueOnPage[] = [];
    const pageSeoScores: number[] = [];
    const pageGeoScores: number[] = [];

    for (const page of self.pages) {
      const seoIssues = seoIssuesForPage(page);
      const geoIssues = geoIssuesForPage(page);
      const seoScore = scoreFromIssues(seoIssues);
      const geoScore = scoreFromIssues(geoIssues);
      pageSeoScores.push(seoScore);
      pageGeoScores.push(geoScore);
      for (const issue of [...seoIssues, ...geoIssues]) pageIssues.push({ url: page.url, issue });
      pageRows.push(pageRow(auditId, site.id, "self", page, seoIssues, geoIssues, seoScore, geoScore));
    }
    for (const comp of competitors) {
      for (const page of comp.pages) {
        pageRows.push(pageRow(auditId, site.id, "competitor", page, [], [], 0, 0));
      }
    }

    const siteSeoIssues = seoIssuesForSite(self.signals);
    const siteGeoIssues = geoIssuesForSite(self.signals);

    const providerSignals = await gatherProviderSignals(
      site,
      { env: deps.env ?? {}, fetchImpl: deps.fetchImpl, signal: deps.signal },
      deps.providers,
    );

    const gaps = competitorGaps(self, competitors);
    const competitorText = competitors.map((c) => ({ domain: c.domain, text: siteText(c) }));
    const trendGaps = await discoverTrendGaps(site.keywords, siteText(self), competitorText, {
      env: deps.env,
      quick: true,
      runResearch: deps.runResearch,
    });

    const facts: AuditFacts = {
      domain: site.domain,
      keywords: site.keywords,
      pageIssues,
      siteIssues: [...siteSeoIssues, ...siteGeoIssues],
      trendGaps,
      competitorGaps: [...gaps, ...providerSignals.notes],
    };

    const drafts = await generateRecommendations(facts, {
      client: deps.reasonerClient,
      meter: deps.meter,
    });

    insertPages(db, pageRows);
    insertTrends(db, trendRows(auditId, site.id, trendGaps));
    insertRankings(db, rankingRows(auditId, site.id, providerSignals.rankings, ts));

    const diff = applyRecommendations(db, site.id, auditId, drafts, {
      now,
      autoResolveAfterRuns: deps.autoResolveAfterRuns,
    });

    const scores = computeScores(
      pageSeoScores,
      pageGeoScores,
      siteSeoIssues,
      siteGeoIssues,
      gaps.length,
    );

    const summary = `Crawled ${self.pages.length} pages. ${diff.created} new, ${diff.total} total to-dos. Scores SEO ${scores.seo} / GEO ${scores.geo}.`;
    finishAudit(db, auditId, { status: "ok", scores, summary, newRecCount: diff.created }, now);

    await notifyNewRecommendations(db, site, auditId, diff.created, deps.notifiers);

    return {
      auditId,
      siteId: site.id,
      status: "ok",
      scores,
      pagesCrawled: self.pages.length,
      recommendationsTotal: diff.total,
      recommendationsNew: diff.created,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishAudit(db, auditId, { status: "error", error: message }, now);
    return {
      auditId,
      siteId: site.id,
      status: "error",
      scores: { seo: 0, geo: 0, competitor: 0, overall: 0 },
      pagesCrawled: 0,
      recommendationsTotal: 0,
      recommendationsNew: 0,
      error: message,
    };
  }
}

function pageRow(
  auditId: string,
  siteId: string,
  role: "self" | "competitor",
  page: import("./types").PageMetrics,
  seoIssues: SeoIssue[],
  geoIssues: SeoIssue[],
  seoScore: number,
  geoScore: number,
): NewSeoPage {
  return {
    id: randomUUID(),
    auditId,
    siteId,
    role,
    url: page.url,
    title: page.title,
    metaDescription: page.metaDescription,
    canonical: page.canonical,
    h1s: page.h1s,
    jsonLdTypes: page.jsonLdTypes,
    wordCount: page.wordCount,
    seoIssues,
    geoIssues,
    seoScore,
    geoScore,
  };
}

function trendRows(
  auditId: string,
  siteId: string,
  trends: import("./types").TrendTerm[],
): NewSeoTrend[] {
  return trends.map((t) => ({
    id: randomUUID(),
    auditId,
    siteId,
    term: t.term,
    source: t.source,
    momentum: t.momentum,
    onSelf: t.onSelf,
    onCompetitors: t.onCompetitors,
    gap: t.gap,
  }));
}

function rankingRows(
  auditId: string,
  siteId: string,
  rankings: import("./providers").KeywordRanking[],
  ts: string,
): NewSeoRanking[] {
  return rankings.map((r) => ({
    id: randomUUID(),
    auditId,
    siteId,
    keyword: r.keyword,
    engine: r.engine,
    position: r.position,
    url: r.url,
    competitorsAhead: r.competitorsAhead,
    capturedAt: ts,
  }));
}

async function notifyNewRecommendations(
  db: DB,
  site: SeoSite,
  auditId: string,
  newCount: number,
  notifiers?: Notifier[],
): Promise<void> {
  if (!notifiers || notifiers.length === 0 || newCount === 0) return;
  const fresh = openRecommendations(db, site.id, auditId).filter(
    (r) => r.isNew && r.impact === "high",
  );
  if (fresh.length === 0) return;
  const body = fresh
    .slice(0, 5)
    .map((r) => `• ${r.title}`)
    .join("\n");
  await notifyAll(notifiers, {
    title: `${fresh.length} new high-impact SEO/GEO to-dos for ${site.label}`,
    body,
    priority: "high",
  });
}
