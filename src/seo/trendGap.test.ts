import { describe, it, expect } from "vitest";
import { computeTrendGaps, discoverTrendGaps, extractTrendTerms } from "./trendGap";
import type { ResearchReport } from "@/research/last30days";

function report(): ResearchReport {
  return {
    topic: "frcr",
    rangeFrom: "2026-05-01",
    rangeTo: "2026-06-01",
    itemsBySource: {
      reddit: [
        { title: "Rapid reporting tips for FRCR", url: "u1", snippet: "", engagement: { score: 200 } },
        { title: "Rapid reporting practice sets", url: "u2", snippet: "", engagement: { score: 150 } },
      ],
    },
    errorsBySource: {},
    warnings: [],
  };
}

describe("extractTrendTerms", () => {
  it("ranks recurring phrases above one-off words", () => {
    const terms = extractTrendTerms(report());
    expect(terms[0]!.term).toContain("rapid reporting");
    expect(terms[0]!.momentum).toBe(1);
  });
});

describe("computeTrendGaps", () => {
  it("flags a term absent from self but present on a competitor as a gap", () => {
    const gaps = computeTrendGaps(
      [{ term: "rapid reporting", source: "reddit", momentum: 0.9 }],
      "our site is about frcr question banks",
      [{ domain: "radiologycafe.com", text: "guide to rapid reporting" }],
    );
    expect(gaps[0]!.gap).toBe(true);
    expect(gaps[0]!.onSelf).toBe(false);
    expect(gaps[0]!.onCompetitors).toEqual(["radiologycafe.com"]);
  });

  it("does not flag a term you already cover", () => {
    const gaps = computeTrendGaps(
      [{ term: "rapid reporting", source: "reddit", momentum: 0.9 }],
      "we offer rapid reporting practice",
      [],
    );
    expect(gaps[0]!.gap).toBe(false);
    expect(gaps[0]!.onSelf).toBe(true);
  });
});

describe("discoverTrendGaps", () => {
  it("uses an injected research runner and returns gaps offline", async () => {
    const gaps = await discoverTrendGaps(["frcr"], "question bank", [], {
      runResearch: async () => report(),
    });
    expect(gaps.some((g) => g.term.includes("rapid reporting"))).toBe(true);
  });

  it("returns empty when research fails", async () => {
    const gaps = await discoverTrendGaps(["frcr"], "x", [], {
      runResearch: async () => {
        throw new Error("offline");
      },
    });
    expect(gaps).toEqual([]);
  });
});
