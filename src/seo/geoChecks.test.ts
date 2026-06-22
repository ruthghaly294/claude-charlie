import { describe, it, expect } from "vitest";
import { geoIssuesForPage, geoIssuesForSite } from "./geoChecks";
import type { PageMetrics, SiteSignals } from "./types";

function page(over: Partial<PageMetrics> = {}): PageMetrics {
  return {
    url: "https://x.com/",
    status: 200,
    title: "T",
    metaDescription: "",
    canonical: "",
    ogTitle: "",
    h1s: ["H"],
    headings: ["How do I revise for the FRCR Part 1 exam?"],
    jsonLdTypes: ["FAQPage"],
    wordCount: 600,
    imagesTotal: 0,
    imagesWithAlt: 0,
    internalLinks: 2,
    externalLinks: 0,
    hasViewportMeta: true,
    text: "Updated March 2026. The pass rate is 67%. Reviewed by Dr Smith, consultant radiologist.",
    ...over,
  };
}

describe("geoIssuesForPage", () => {
  it("returns no issues for a citable, well-structured page", () => {
    expect(geoIssuesForPage(page())).toEqual([]);
  });

  it("flags absence of structured data as high impact", () => {
    const issues = geoIssuesForPage(page({ jsonLdTypes: [] }));
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "geo.no_structured_data", impact: "high" }),
    );
  });

  it("flags weak schema when JSON-LD has no high-value type", () => {
    const issues = geoIssuesForPage(page({ jsonLdTypes: ["WebPage"] }));
    expect(issues).toContainEqual(expect.objectContaining({ code: "geo.weak_schema" }));
  });

  it("flags missing Q&A when no FAQ schema and no question headings", () => {
    const issues = geoIssuesForPage(
      page({ jsonLdTypes: ["Article"], headings: ["Overview"] }),
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: "geo.no_qa" }));
  });

  it("flags missing citable facts and freshness", () => {
    const codes = geoIssuesForPage(page({ text: "Some generic prose without specifics." })).map(
      (i) => i.code,
    );
    expect(codes).toEqual(
      expect.arrayContaining(["geo.no_citable_facts", "geo.no_freshness", "geo.no_author"]),
    );
  });

  it("ignores non-200 pages", () => {
    expect(geoIssuesForPage(page({ status: 404, jsonLdTypes: [] }))).toEqual([]);
  });
});

describe("geoIssuesForSite", () => {
  it("flags missing llms.txt and blocked AI bots", () => {
    const signals: SiteSignals = {
      hasRobotsTxt: true,
      hasSitemap: true,
      hasLlmsTxt: false,
      blockedAiBots: ["GPTBot", "ClaudeBot"],
      robotsTxt: "",
    };
    const codes = geoIssuesForSite(signals).map((i) => i.code);
    expect(codes).toContain("geo.no_llms_txt");
    expect(codes).toContain("geo.ai_blocked");
  });
});
