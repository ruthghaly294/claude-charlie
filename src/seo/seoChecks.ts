import type { PageMetrics, SeoIssue, SiteSignals } from "./types";

const PENALTY: Record<SeoIssue["impact"], number> = { high: 20, medium: 10, low: 5 };

/** Map a list of issues to a 0–100 score (100 = clean). */
export function scoreFromIssues(issues: SeoIssue[]): number {
  const total = issues.reduce((s, i) => s + PENALTY[i.impact], 0);
  return Math.max(0, 100 - total);
}

/** Classic on-page SEO issues for a single crawled page. */
export function seoIssuesForPage(page: PageMetrics): SeoIssue[] {
  const issues: SeoIssue[] = [];

  if (!page.title) {
    issues.push({ code: "title.missing", message: "Page has no <title>", impact: "high" });
  } else if (page.title.length > 60) {
    issues.push({
      code: "title.too_long",
      message: `Title is ${page.title.length} chars (keep under 60 to avoid truncation)`,
      impact: "low",
    });
  } else if (page.title.length < 10) {
    issues.push({ code: "title.too_short", message: "Title is very short", impact: "medium" });
  }

  if (!page.metaDescription) {
    issues.push({
      code: "meta.missing",
      message: "Missing meta description",
      impact: "medium",
    });
  } else if (page.metaDescription.length > 160) {
    issues.push({
      code: "meta.too_long",
      message: `Meta description is ${page.metaDescription.length} chars (keep under 160)`,
      impact: "low",
    });
  } else if (page.metaDescription.length < 50) {
    issues.push({ code: "meta.too_short", message: "Meta description is thin", impact: "low" });
  }

  if (page.h1s.length === 0) {
    issues.push({ code: "h1.missing", message: "Page has no <h1>", impact: "medium" });
  } else if (page.h1s.length > 1) {
    issues.push({
      code: "h1.multiple",
      message: `Page has ${page.h1s.length} <h1> tags (use exactly one)`,
      impact: "low",
    });
  }

  if (page.wordCount < 300 && page.status === 200) {
    issues.push({
      code: "content.thin",
      message: `Thin content (${page.wordCount} words)`,
      impact: "medium",
    });
  }

  if (page.imagesTotal > 0 && page.imagesWithAlt < page.imagesTotal) {
    issues.push({
      code: "images.alt",
      message: `${page.imagesTotal - page.imagesWithAlt}/${page.imagesTotal} images missing alt text`,
      impact: "low",
    });
  }

  if (!page.canonical) {
    issues.push({ code: "canonical.missing", message: "No canonical link", impact: "low" });
  }

  if (!page.hasViewportMeta) {
    issues.push({
      code: "mobile.viewport",
      message: "No mobile viewport meta tag",
      impact: "medium",
    });
  }

  if (page.internalLinks === 0 && page.status === 200) {
    issues.push({
      code: "links.no_internal",
      message: "Page has no internal links",
      impact: "low",
    });
  }

  if (page.status >= 400 || page.status === 0) {
    issues.push({
      code: "http.error",
      message: `Page returned HTTP ${page.status}`,
      impact: "high",
    });
  }

  return issues;
}

/** Site-wide SEO issues derived from robots.txt / sitemap presence. */
export function seoIssuesForSite(signals: SiteSignals): SeoIssue[] {
  const issues: SeoIssue[] = [];
  if (!signals.hasRobotsTxt) {
    issues.push({ code: "site.no_robots", message: "No robots.txt found", impact: "low" });
  }
  if (!signals.hasSitemap) {
    issues.push({
      code: "site.no_sitemap",
      message: "No sitemap.xml found (hurts crawl coverage)",
      impact: "medium",
    });
  }
  return issues;
}
