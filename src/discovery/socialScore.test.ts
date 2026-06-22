import { describe, it, expect } from "vitest";
import { engagementMagnitude, socialPercentiles, applySocialBoost } from "./socialScore";

describe("engagementMagnitude", () => {
  it("log-scales the sum of points/comments/views", () => {
    expect(engagementMagnitude({ source: "reddit", points: 99 })).toBeCloseTo(
      Math.log1p(99),
    );
    expect(
      engagementMagnitude({ source: "reddit", points: 10, comments: 5, views: 85 }),
    ).toBeCloseTo(Math.log1p(100));
  });

  it("treats missing/negative fields as zero", () => {
    expect(engagementMagnitude({ source: "reddit" })).toBe(0);
    expect(engagementMagnitude({ source: "reddit", points: -5 })).toBe(0);
  });
});

describe("socialPercentiles", () => {
  it("gives no-penalty (1) to items with no engagement data at all", () => {
    const out = socialPercentiles([
      { source: "rss" },
      { source: "rss", points: null, comments: null, views: null },
    ]);
    expect(out).toEqual([1, 1]);
  });

  it("ranks items within a source from 0 (least engagement) to 1 (most)", () => {
    const out = socialPercentiles([
      { source: "reddit", points: 1 },
      { source: "reddit", points: 100 },
      { source: "reddit", points: 10 },
    ]);
    expect(out[0]).toBe(0); // fewest points
    expect(out[2]).toBe(0.5); // middle
    expect(out[1]).toBe(1); // most points
  });

  it("ranks each source independently", () => {
    const out = socialPercentiles([
      { source: "reddit", points: 1 },
      { source: "reddit", points: 100 },
      { source: "hackernews", points: 1 },
      { source: "hackernews", points: 100 },
    ]);
    // both groups have the same low/high split, independent of each other
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(1);
    expect(out[2]).toBe(0);
    expect(out[3]).toBe(1);
  });

  it("gives tied items the same percentile", () => {
    const out = socialPercentiles([
      { source: "reddit", points: 5 },
      { source: "reddit", points: 5 },
      { source: "reddit", points: 50 },
    ]);
    expect(out[0]).toBe(out[1]);
    expect(out[0]!).toBeLessThan(out[2]!);
  });

  it("gives a no-penalty (1) when every item in the source has identical engagement", () => {
    const out = socialPercentiles([
      { source: "reddit", points: 5 },
      { source: "reddit", points: 5 },
    ]);
    expect(out).toEqual([1, 1]);
  });

  it("a singleton group with data gets no penalty (1)", () => {
    const out = socialPercentiles([{ source: "reddit", points: 5 }]);
    expect(out).toEqual([1]);
  });

  it("items without data don't affect or get affected by ranked items in the same source", () => {
    const out = socialPercentiles([
      { source: "reddit", points: 1 },
      { source: "reddit", points: 100 },
      { source: "reddit" },
    ]);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(1);
    expect(out[2]).toBe(1);
  });
});

describe("applySocialBoost", () => {
  it("leaves keywordScore unchanged at percentile 1", () => {
    expect(applySocialBoost(0.8, 1)).toBeCloseTo(0.8);
  });

  it("halves keywordScore at percentile 0", () => {
    expect(applySocialBoost(0.8, 0)).toBeCloseTo(0.4);
  });

  it("interpolates linearly between 0.5x and 1x", () => {
    expect(applySocialBoost(0.8, 0.5)).toBeCloseTo(0.6);
  });
});
