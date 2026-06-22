import { z } from "zod";
import type { SeoIssue, SeoScores } from "@/db/schema";

export type { SeoIssue, SeoScores };

export type PageRole = "self" | "competitor";

/** What a single crawled page yields, before issue detection. */
export type PageMetrics = {
  url: string;
  status: number;
  title: string;
  metaDescription: string;
  canonical: string;
  ogTitle: string;
  h1s: string[];
  headings: string[];
  jsonLdTypes: string[];
  wordCount: number;
  imagesTotal: number;
  imagesWithAlt: number;
  internalLinks: number;
  externalLinks: number;
  hasViewportMeta: boolean;
  text: string;
};

/** Site-level signals that aren't tied to one page (robots/sitemap/llms.txt). */
export type SiteSignals = {
  hasRobotsTxt: boolean;
  hasSitemap: boolean;
  hasLlmsTxt: boolean;
  /** AI crawler user-agents that robots.txt explicitly disallows. */
  blockedAiBots: string[];
  robotsTxt: string;
};

/** A fully crawled site: its pages plus site-wide signals. */
export type CrawlResult = {
  domain: string;
  pages: PageMetrics[];
  signals: SiteSignals;
};

export type TrendTerm = {
  term: string;
  source: string;
  momentum: number;
  onSelf: boolean;
  onCompetitors: string[];
  gap: boolean;
};

export const RECOMMENDATION_CATEGORIES = [
  "seo",
  "geo",
  "content",
  "technical",
  "trend-gap",
  "competitor-gap",
] as const;
export type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number];

export type Severity = "high" | "medium" | "low";

/** A candidate recommendation produced by the analysis, before persistence/diffing. */
export type RecommendationDraft = {
  category: RecommendationCategory;
  title: string;
  detail: string;
  executionSteps: string[];
  impact: Severity;
  effort: Severity;
  evidence: string[];
  /** optional URL the rec is about — folded into the fingerprint for stability */
  targetUrl?: string;
};

/** Zod schema constraining the model's structured recommendation output. */
export const recommendationDraftSchema = z.object({
  category: z.enum(RECOMMENDATION_CATEGORIES),
  title: z.string(),
  detail: z.string(),
  executionSteps: z.array(z.string()),
  impact: z.enum(["high", "medium", "low"]),
  effort: z.enum(["high", "medium", "low"]),
  evidence: z.array(z.string()).default([]),
  targetUrl: z.string().optional(),
});

export const recommendationListSchema = z.object({
  recommendations: z.array(recommendationDraftSchema),
});

export type AuditSummary = {
  auditId: string;
  siteId: string;
  status: "ok" | "partial" | "error";
  scores: SeoScores;
  pagesCrawled: number;
  recommendationsTotal: number;
  recommendationsNew: number;
  error?: string;
};
