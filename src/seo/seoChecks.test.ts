import { describe, it, expect } from "vitest";
import { scoreFromIssues, seoIssuesForPage, seoIssuesForSite } from "./seoChecks";
import type { PageMetrics, SiteSignals } from "./types";

function page(over: Partial<PageMetrics> = {}): PageMetrics {
  return {
    url: "https://x.com/",
    status: 200,
    title: "A reasonable title for the page",
    metaDescription: "A meta description that is comfortably within the recommended length window.",
    canonical: "https://x.com/",
    ogTitle: "X",
    h1s: ["Heading"],
    headings: ["Heading"],
    jsonLdTypes: [],
    wordCount: 800,
    imagesTotal: 2,
    imagesWithAlt: 2,
    internalLinks: 5,
    externalLinks: 1,
    hasViewportMeta: true,
    text: "lots of content",
    ...over,
  };
}

describe("seoIssuesForPage", () => {
  it("returns no issues for a clean page", () => {
    expect(seoIssuesForPage(page())).toEqual([]);
  });

  it("flags a missing title as high impact", () => {
    const issues = seoIssuesForPage(page({ title: "" }));
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "title.missing", impact: "high" }),
    );
  });

  it("flags missing meta description, thin content, and missing viewport", () => {
    const codes = seoIssuesForPage(
      page({ metaDescription: "", wordCount: 120, hasViewportMeta: false }),
    ).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining(["meta.missing", "content.thin", "mobile.viewport"]),
    );
  });

  it("flags multiple h1 tags", () => {
    const issues = seoIssuesForPage(page({ h1s: ["a", "b"] }));
    expect(issues).toContainEqual(expect.objectContaining({ code: "h1.multiple" }));
  });

  it("flags images missing alt text", () => {
    const issues = seoIssuesForPage(page({ imagesTotal: 3, imagesWithAlt: 1 }));
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "images.alt", message: expect.stringContaining("2/3") }),
    );
  });
});

describe("seoIssuesForSite", () => {
  it("flags a missing sitemap", () => {
    const signals: SiteSignals = {
      hasRobotsTxt: true,
      hasSitemap: false,
      hasLlmsTxt: false,
      blockedAiBots: [],
      robotsTxt: "",
    };
    expect(seoIssuesForSite(signals)).toContainEqual(
      expect.objectContaining({ code: "site.no_sitemap" }),
    );
  });
});

describe("scoreFromIssues", () => {
  it("subtracts weighted penalties from 100", () => {
    expect(scoreFromIssues([])).toBe(100);
    expect(scoreFromIssues([{ code: "x", message: "", impact: "high" }])).toBe(80);
    expect(
      scoreFromIssues([
        { code: "x", message: "", impact: "high" },
        { code: "y", message: "", impact: "medium" },
      ]),
    ).toBe(70);
  });

  it("never drops below zero", () => {
    const many = Array.from({ length: 10 }, () => ({
      code: "x",
      message: "",
      impact: "high" as const,
    }));
    expect(scoreFromIssues(many)).toBe(0);
  });
});
