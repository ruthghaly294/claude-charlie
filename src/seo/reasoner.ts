import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { UsageMeter } from "@/discovery/usage";
import {
  recommendationListSchema,
  type RecommendationCategory,
  type RecommendationDraft,
  type SeoIssue,
  type Severity,
  type TrendTerm,
} from "./types";

/** Minimal Anthropic surface (mirrors property/llmExtract's ExtractClient). */
export interface ReasonerClient {
  messages: {
    parse: (body: Record<string, unknown>) => Promise<{
      parsed_output: unknown;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>;
  };
}

export type IssueOnPage = { url: string; issue: SeoIssue };

export type AuditFacts = {
  domain: string;
  keywords: string[];
  /** every page-level issue, tagged with the page it was found on */
  pageIssues: IssueOnPage[];
  /** site-wide SEO + GEO issues (robots/sitemap/llms.txt/ai-blocked) */
  siteIssues: SeoIssue[];
  trendGaps: TrendTerm[];
  /** "competitors do X, you don't" fact strings */
  competitorGaps: string[];
};

const DEFAULT_MODEL = "claude-opus-4-8";

const CATEGORY_BY_PREFIX: Record<string, RecommendationCategory> = {
  geo: "geo",
  title: "seo",
  meta: "seo",
  h1: "seo",
  canonical: "seo",
  images: "seo",
  mobile: "technical",
  links: "seo",
  http: "technical",
  content: "content",
  site: "technical",
};

function categoryFor(code: string): RecommendationCategory {
  return CATEGORY_BY_PREFIX[code.split(".")[0]!] ?? "seo";
}

const STEPS_BY_CODE: Record<string, string[]> = {
  "geo.no_llms_txt": [
    "Create /llms.txt listing your key pages and a one-line site summary",
    "Optionally add /llms-full.txt with fuller content for AI assistants",
  ],
  "geo.ai_blocked": [
    "Edit robots.txt to allow GPTBot, ClaudeBot, PerplexityBot and Google-Extended",
    "Confirm no CDN/WAF rule blocks AI crawler user-agents",
  ],
  "geo.no_structured_data": [
    "Add JSON-LD structured data (Organization/Article/FAQPage as appropriate)",
    "Validate with a schema testing tool",
  ],
  "geo.no_qa": [
    "Add an FAQ section with concise, directly-quotable answers",
    "Mark it up with FAQPage schema",
  ],
  "meta.missing": ["Write a unique 50–160 char meta description per page"],
  "title.missing": ["Add a unique, keyword-led <title> under 60 chars"],
  "content.thin": ["Expand the page past 300 words of genuinely useful content"],
  "site.no_sitemap": ["Generate sitemap.xml and reference it in robots.txt"],
};

function worst(a: Severity, b: Severity): Severity {
  const rank: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
  return rank[a] >= rank[b] ? a : b;
}

/**
 * Grounded recommendations derived directly from detected facts — no model
 * required. Page-level issues are grouped by code (so "12 pages missing meta"
 * is one to-do, not twelve), plus one draft per trend gap and competitor gap.
 */
export function deterministicDrafts(facts: AuditFacts): RecommendationDraft[] {
  const drafts: RecommendationDraft[] = [];

  for (const issue of facts.siteIssues) {
    drafts.push({
      category: categoryFor(issue.code),
      title: issue.message,
      detail: `Site-wide issue (${issue.code}).`,
      executionSteps: STEPS_BY_CODE[issue.code] ?? [],
      impact: issue.impact,
      effort: issue.impact === "high" ? "medium" : "low",
      evidence: [facts.domain],
    });
  }

  const byCode = new Map<string, { impact: Severity; message: string; urls: string[] }>();
  for (const { url, issue } of facts.pageIssues) {
    const cur = byCode.get(issue.code);
    if (cur) {
      cur.impact = worst(cur.impact, issue.impact);
      if (cur.urls.length < 10) cur.urls.push(url);
    } else {
      byCode.set(issue.code, { impact: issue.impact, message: issue.message, urls: [url] });
    }
  }
  for (const [code, info] of byCode) {
    const n = info.urls.length;
    drafts.push({
      category: categoryFor(code),
      title: `${info.message}${n > 1 ? ` (${n}+ pages)` : ""}`,
      detail: `Detected on ${n} page${n === 1 ? "" : "s"}.`,
      executionSteps: STEPS_BY_CODE[code] ?? [],
      impact: info.impact,
      effort: "low",
      evidence: info.urls.slice(0, 5),
      targetUrl: n === 1 ? info.urls[0] : undefined,
    });
  }

  for (const t of facts.trendGaps.filter((g) => g.gap)) {
    drafts.push({
      category: "trend-gap",
      title: `Cover the trending topic "${t.term}"`,
      detail: `"${t.term}" is gaining momentum (${t.source})${
        t.onCompetitors.length ? ` and competitors already mention it` : ""
      }, but your site doesn't.`,
      executionSteps: [
        `Create or update a page targeting "${t.term}"`,
        "Interlink it from related pages",
      ],
      impact: t.onCompetitors.length > 0 ? "medium" : "low",
      effort: "medium",
      evidence: t.onCompetitors,
    });
  }

  for (const gap of facts.competitorGaps) {
    drafts.push({
      category: "competitor-gap",
      title: gap,
      detail: "Competitor advantage you can close.",
      executionSteps: [],
      impact: "medium",
      effort: "medium",
      evidence: [],
    });
  }

  return drafts;
}

const SYSTEM = `You are an SEO and GEO (generative-engine optimization) consultant. You are given structured audit facts about a website: detected on-page issues, site-wide issues, trending-keyword gaps, and competitor gaps. Produce a prioritized, de-duplicated list of concrete recommendations. Each must have a short imperative title, a one-paragraph detail, 1–4 execution steps, an impact and effort rating, and evidence (URLs or competitor names). Merge related issues into single recommendations. Prefer the highest-leverage actions first. Only recommend things grounded in the supplied facts.`;

function factsToPrompt(facts: AuditFacts): string {
  return JSON.stringify(
    {
      domain: facts.domain,
      keywords: facts.keywords,
      siteIssues: facts.siteIssues,
      pageIssues: facts.pageIssues.slice(0, 80),
      trendGaps: facts.trendGaps.filter((g) => g.gap).slice(0, 20),
      competitorGaps: facts.competitorGaps.slice(0, 20),
    },
    null,
    0,
  );
}

export type ReasonerOptions = {
  client?: ReasonerClient | null;
  model?: string;
  meter?: UsageMeter;
};

/**
 * Turn audit facts into recommendation drafts. With a configured Claude client
 * the model synthesizes and prioritizes; without one (or on any failure) we
 * fall back to grounded deterministic drafts so the pipeline always produces a
 * usable plan — same graceful-degradation rule as property/llmExtract.
 */
export async function generateRecommendations(
  facts: AuditFacts,
  opts: ReasonerOptions = {},
): Promise<RecommendationDraft[]> {
  if (!opts.client) return deterministicDrafts(facts);
  const model = opts.model ?? DEFAULT_MODEL;
  try {
    const res = await opts.client.messages.parse({
      model,
      max_tokens: 4000,
      output_config: { format: zodOutputFormat(recommendationListSchema), effort: "high" },
      system: SYSTEM,
      messages: [{ role: "user", content: factsToPrompt(facts) }],
    });
    if (opts.meter && res.usage) {
      opts.meter.record(model, {
        inputTokens: res.usage.input_tokens ?? 0,
        outputTokens: res.usage.output_tokens ?? 0,
      });
    }
    const parsed = recommendationListSchema.parse(res.parsed_output);
    return parsed.recommendations.length > 0
      ? parsed.recommendations
      : deterministicDrafts(facts);
  } catch {
    return deterministicDrafts(facts);
  }
}

/** Build a real Anthropic-backed reasoner client, or null to stay deterministic. */
export function getReasonerClient(
  env: Record<string, string | undefined> = process.env,
): ReasonerClient | null {
  if (!env.ANTHROPIC_API_KEY || env.DECODE_REASONER === "deterministic") return null;
  return new Anthropic() as unknown as ReasonerClient;
}
