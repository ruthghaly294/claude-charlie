import { describe, it, expect } from "vitest";
import { competitorGaps } from "./competitor";
import type { CrawlResult, PageMetrics, SiteSignals } from "./types";

function page(over: Partial<PageMetrics> = {}): PageMetrics {
  return {
    url: "https://x.com/",
    status: 200,
    title: "",
    metaDescription: "",
    canonical: "",
    ogTitle: "",
    h1s: [],
    headings: [],
    jsonLdTypes: [],
    wordCount: 200,
    imagesTotal: 0,
    imagesWithAlt: 0,
    internalLinks: 0,
    externalLinks: 0,
    hasViewportMeta: true,
    text: "",
    ...over,
  };
}

function signals(over: Partial<SiteSignals> = {}): SiteSignals {
  return {
    hasRobotsTxt: true,
    hasSitemap: true,
    hasLlmsTxt: false,
    blockedAiBots: [],
    robotsTxt: "",
    ...over,
  };
}

function crawl(domain: string, pages: PageMetrics[], sig?: Partial<SiteSignals>): CrawlResult {
  return { domain, pages, signals: signals(sig) };
}

describe("competitorGaps", () => {
  it("flags schema types competitors use that you lack", () => {
    const self = crawl("https://frcrbank.com", [page({ jsonLdTypes: ["WebSite"] })]);
    const comp = crawl("https://radiologycafe.com", [page({ jsonLdTypes: ["FAQPage"] })]);
    const gaps = competitorGaps(self, [comp]);
    expect(gaps.some((g) => g.includes("FAQPage") && g.includes("radiologycafe.com"))).toBe(true);
  });

  it("flags competitor llms.txt adoption", () => {
    const self = crawl("https://frcrbank.com", [page()], { hasLlmsTxt: false });
    const comp = crawl("https://radiologycafe.com", [page()], { hasLlmsTxt: true });
    expect(competitorGaps(self, [comp]).some((g) => g.includes("llms.txt"))).toBe(true);
  });

  it("flags materially deeper competitor content", () => {
    const self = crawl("https://frcrbank.com", [page({ wordCount: 200 })]);
    const comp = crawl("https://radiologycafe.com", [page({ wordCount: 900 })]);
    expect(competitorGaps(self, [comp]).some((g) => g.includes("deeper"))).toBe(true);
  });

  it("returns nothing when you match competitors", () => {
    const self = crawl("https://frcrbank.com", [page({ jsonLdTypes: ["FAQPage"], wordCount: 800 })], {
      hasLlmsTxt: true,
    });
    const comp = crawl("https://radiologycafe.com", [page({ jsonLdTypes: ["FAQPage"], wordCount: 800 })], {
      hasLlmsTxt: true,
    });
    expect(competitorGaps(self, [comp])).toEqual([]);
  });
});
