import { describe, it, expect, vi } from "vitest";
import { deterministicDrafts, generateRecommendations, type AuditFacts } from "./reasoner";

function facts(over: Partial<AuditFacts> = {}): AuditFacts {
  return {
    domain: "https://frcrbank.com",
    keywords: ["frcr"],
    pageIssues: [
      { url: "https://frcrbank.com/a", issue: { code: "meta.missing", message: "Missing meta description", impact: "medium" } },
      { url: "https://frcrbank.com/b", issue: { code: "meta.missing", message: "Missing meta description", impact: "medium" } },
    ],
    siteIssues: [
      { code: "geo.no_llms_txt", message: "No /llms.txt", impact: "medium" },
    ],
    trendGaps: [
      { term: "rapid reporting", source: "reddit", momentum: 0.8, onSelf: false, onCompetitors: ["x.com"], gap: true },
    ],
    competitorGaps: ["Competitor publishes a free mock exam; you don't"],
    ...over,
  };
}

describe("deterministicDrafts", () => {
  it("groups repeated page issues into a single recommendation with a count", () => {
    const drafts = deterministicDrafts(facts());
    const meta = drafts.find((d) => d.title.startsWith("Missing meta description"));
    expect(meta?.title).toContain("2+ pages");
    expect(meta?.category).toBe("seo");
  });

  it("emits site, trend-gap, and competitor-gap recommendations", () => {
    const cats = deterministicDrafts(facts()).map((d) => d.category);
    expect(cats).toContain("geo");
    expect(cats).toContain("trend-gap");
    expect(cats).toContain("competitor-gap");
  });

  it("attaches execution steps for known issue codes", () => {
    const llms = deterministicDrafts(facts()).find((d) => d.title.includes("llms.txt"));
    expect(llms?.executionSteps.length).toBeGreaterThan(0);
  });
});

describe("generateRecommendations", () => {
  it("falls back to deterministic drafts with no client", async () => {
    const drafts = await generateRecommendations(facts(), { client: null });
    expect(drafts.length).toBeGreaterThan(0);
  });

  it("uses the model's structured output when a client is provided", async () => {
    const parse = vi.fn(async () => ({
      parsed_output: {
        recommendations: [
          {
            category: "geo",
            title: "Publish an llms.txt",
            detail: "Help AI assistants find key pages.",
            executionSteps: ["Create /llms.txt"],
            impact: "high",
            effort: "low",
            evidence: ["https://frcrbank.com"],
          },
        ],
      },
      usage: { input_tokens: 10, output_tokens: 20 },
    }));
    const drafts = await generateRecommendations(facts(), { client: { messages: { parse } } });
    expect(parse).toHaveBeenCalledOnce();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.title).toBe("Publish an llms.txt");
  });

  it("falls back to deterministic drafts if the model call throws", async () => {
    const parse = vi.fn(async () => {
      throw new Error("rate limited");
    });
    const drafts = await generateRecommendations(facts(), { client: { messages: { parse } } });
    expect(drafts.length).toBeGreaterThan(0);
  });
});
