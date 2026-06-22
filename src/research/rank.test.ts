import { describe, it, expect } from "vitest";
import { rankReport } from "./rank";
import type { ResearchReport, ResearchItem } from "./last30days";

const NOW = "2026-06-14T00:00:00.000Z";

function item(overrides: Partial<ResearchItem>): ResearchItem {
  return {
    title: "Untitled",
    url: "https://example.com/x",
    snippet: "",
    engagement: {},
    ...overrides,
  };
}

describe("rankReport", () => {
  it("scores items higher when they match a keyword with a higher multiplier", () => {
    const report: ResearchReport = {
      topic: "ai agents",
      rangeFrom: "2026-05-15",
      rangeTo: "2026-06-14",
      itemsBySource: {
        hackernews: [
          item({ title: "Great AI Tools", url: "https://example.com/ai" }),
          item({ title: "Random Cooking Tips", url: "https://example.com/cooking" }),
        ],
      },
      errorsBySource: {},
      warnings: [],
    };

    const ranked = rankReport(report, {
      keywords: ["ai"],
      multipliers: { ai: 1.5 },
      weights: { relevance: 1, engagement: 0, recency: 0 },
      halfLifeDays: 7,
      topN: 10,
      now: () => NOW,
    });

    const [first, second] = ranked.itemsBySource.hackernews!;
    expect(first!.url).toBe("https://example.com/ai");
    expect(second!.url).toBe("https://example.com/cooking");
    expect(first!.score).toBeGreaterThan(second!.score);
    expect(second!.score).toBe(0);
  });

  it("scores more recent items higher via the recency half-life", () => {
    const report: ResearchReport = {
      topic: "ai agents",
      rangeFrom: "2026-05-15",
      rangeTo: "2026-06-14",
      itemsBySource: {
        hackernews: [
          item({
            title: "Item Recent Topic",
            url: "https://example.com/recent",
            publishedAt: NOW,
          }),
          item({
            title: "Item Stale Subject",
            url: "https://example.com/stale",
            publishedAt: "2026-06-07T00:00:00.000Z", // 7 days before NOW
          }),
        ],
      },
      errorsBySource: {},
      warnings: [],
    };

    const ranked = rankReport(report, {
      keywords: [],
      multipliers: {},
      weights: { relevance: 0, engagement: 0, recency: 1 },
      halfLifeDays: 7,
      topN: 10,
      now: () => NOW,
    });

    const [first, second] = ranked.itemsBySource.hackernews!;
    expect(first!.url).toBe("https://example.com/recent");
    expect(second!.url).toBe("https://example.com/stale");
    expect(first!.score).toBeCloseTo(1, 3);
    expect(second!.score).toBeCloseTo(Math.exp(-1), 3);
  });

  it("computes a weighted composite of relevance, engagement, and recency", () => {
    const report: ResearchReport = {
      topic: "ai agents",
      rangeFrom: "2026-05-15",
      rangeTo: "2026-06-14",
      itemsBySource: {
        hackernews: [
          item({
            title: "Special Keyword Match",
            url: "https://example.com/special",
            engagement: { points: 100 },
            publishedAt: NOW,
          }),
          item({
            title: "Different Other Words",
            url: "https://example.com/other",
            engagement: { points: 1 },
            publishedAt: "2026-05-31T00:00:00.000Z", // 14 days before NOW
          }),
        ],
      },
      errorsBySource: {},
      warnings: [],
    };

    const ranked = rankReport(report, {
      keywords: ["special"],
      multipliers: {},
      weights: { relevance: 0.5, engagement: 0.3, recency: 0.2 },
      halfLifeDays: 7,
      topN: 10,
      now: () => NOW,
    });

    const [first, second] = ranked.itemsBySource.hackernews!;
    expect(first!.url).toBe("https://example.com/special");
    expect(first!.score).toBeCloseTo(0.5 * 0.5 + 1 * 0.3 + 1 * 0.2, 3);
    expect(second!.score).toBeCloseTo(0 * 0.5 + 0 * 0.3 + Math.exp(-2) * 0.2, 3);
  });

  it("dedupes near-duplicate cross-source items, keeping the higher-scored one", () => {
    const report: ResearchReport = {
      topic: "ai agents",
      rangeFrom: "2026-05-15",
      rangeTo: "2026-06-14",
      itemsBySource: {
        hackernews: [
          item({
            title: "Best AI Agent Tools 2026 Guide",
            url: "https://example.com/hn",
            publishedAt: NOW,
          }),
        ],
        youtube: [
          item({
            title: "Best AI Agent Tools 2026 Overview",
            url: "https://example.com/yt",
            publishedAt: "2026-05-15T00:00:00.000Z", // 30 days before NOW
          }),
        ],
      },
      errorsBySource: {},
      warnings: [],
    };

    const ranked = rankReport(report, {
      keywords: [],
      multipliers: {},
      weights: { relevance: 0, engagement: 0, recency: 1 },
      halfLifeDays: 7,
      topN: 10,
      now: () => NOW,
    });

    expect(ranked.itemsBySource.hackernews).toEqual([
      expect.objectContaining({ url: "https://example.com/hn" }),
    ]);
    expect(ranked.itemsBySource.youtube).toEqual([]);
    expect(ranked.topPicks).toHaveLength(1);
    expect(ranked.topPicks[0]!.url).toBe("https://example.com/hn");
  });

  it("caps topPicks at topN across all sources", () => {
    const report: ResearchReport = {
      topic: "ai agents",
      rangeFrom: "2026-05-15",
      rangeTo: "2026-06-14",
      itemsBySource: {
        hackernews: [
          item({ title: "Alpha One Signal", url: "https://example.com/a", engagement: { points: 10 } }),
          item({ title: "Beta Two Signal", url: "https://example.com/b", engagement: { points: 5 } }),
        ],
        youtube: [
          item({ title: "Gamma Three Clip", url: "https://example.com/c", engagement: { points: 1 } }),
        ],
      },
      errorsBySource: {},
      warnings: [],
    };

    const ranked = rankReport(report, {
      keywords: [],
      multipliers: {},
      weights: { relevance: 0, engagement: 1, recency: 0 },
      halfLifeDays: 7,
      topN: 2,
      now: () => NOW,
    });

    expect(ranked.topPicks).toHaveLength(2);
  });
});
