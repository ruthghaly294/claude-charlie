import type { PageMetrics, SeoIssue, SiteSignals } from "./types";

/** schema.org types that make a page legible to AI answer engines. */
const VALUABLE_SCHEMA = [
  "Organization",
  "FAQPage",
  "Article",
  "BlogPosting",
  "Product",
  "BreadcrumbList",
  "HowTo",
  "QAPage",
  "WebSite",
];

const QUESTION_RE = /\b(what|how|why|when|where|who|which|can|should|is|are|does)\b.*\?/i;
const STAT_RE = /\b\d{1,3}(?:[.,]\d+)?\s?%|\b\d{4}\b|\b\d[\d,]{2,}\b/;
const DATE_RE =
  /\b(?:updated|published|last reviewed)[^.\n]{0,30}\b(?:\d{1,2}\s)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4})/i;
const AUTHOR_RE = /\b(?:by|author|written by|reviewed by)\b[:\s]+[A-Z]/;

/**
 * On-page GEO (generative-engine optimization) issues — how readable / citable
 * the page is to AI chat assistants. These complement classic SEO.
 */
export function geoIssuesForPage(page: PageMetrics): SeoIssue[] {
  if (page.status !== 200) return [];
  const issues: SeoIssue[] = [];
  const schema = new Set(page.jsonLdTypes.map((t) => t.toLowerCase()));

  const hasValuableSchema = VALUABLE_SCHEMA.some((t) => schema.has(t.toLowerCase()));
  if (page.jsonLdTypes.length === 0) {
    issues.push({
      code: "geo.no_structured_data",
      message: "No JSON-LD structured data — AI engines can't reliably parse this page",
      impact: "high",
    });
  } else if (!hasValuableSchema) {
    issues.push({
      code: "geo.weak_schema",
      message: `JSON-LD present but no high-value type (${VALUABLE_SCHEMA.slice(0, 4).join("/")}…)`,
      impact: "medium",
    });
  }

  const hasFaqSchema = schema.has("faqpage") || schema.has("qapage");
  const hasQuestionHeading = page.headings.some((h) => QUESTION_RE.test(h));
  if (!hasFaqSchema && !hasQuestionHeading) {
    issues.push({
      code: "geo.no_qa",
      message: "No FAQ schema or question-style headings — add direct-answer Q&A blocks",
      impact: "medium",
    });
  }

  if (!STAT_RE.test(page.text)) {
    issues.push({
      code: "geo.no_citable_facts",
      message: "No concrete stats/numbers — AI answers prefer citable, specific facts",
      impact: "low",
    });
  }

  if (!DATE_RE.test(page.text)) {
    issues.push({
      code: "geo.no_freshness",
      message: 'No visible "last updated/published" date — add freshness signals',
      impact: "low",
    });
  }

  if (!AUTHOR_RE.test(page.text)) {
    issues.push({
      code: "geo.no_author",
      message: "No author/byline — E-E-A-T signals improve citation trust",
      impact: "low",
    });
  }

  return issues;
}

/** Site-wide GEO issues: llms.txt and AI-crawler access in robots.txt. */
export function geoIssuesForSite(signals: SiteSignals): SeoIssue[] {
  const issues: SeoIssue[] = [];
  if (!signals.hasLlmsTxt) {
    issues.push({
      code: "geo.no_llms_txt",
      message: "No /llms.txt — add one so AI assistants can find your key content",
      impact: "medium",
    });
  }
  if (signals.blockedAiBots.length > 0) {
    issues.push({
      code: "geo.ai_blocked",
      message: `robots.txt blocks AI crawlers: ${signals.blockedAiBots.join(", ")} — you won't be cited`,
      impact: "high",
    });
  }
  return issues;
}
