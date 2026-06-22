import { describe, it, expect } from "vitest";
import {
  salientTokens,
  jaccardSimilarity,
  mergeClusters,
  applyAuthorCap,
} from "./clusterMerge";

describe("salientTokens", () => {
  it("lowercases, splits on non-alphanumerics, and drops words shorter than 4 chars", () => {
    expect(salientTokens("Best web scraping tools for 2026")).toEqual(
      new Set(["best", "scraping", "tools", "2026"]),
    );
  });
});

describe("jaccardSimilarity", () => {
  it("computes intersection-over-union of two token sets", () => {
    const a = new Set(["scraping", "tools", "2026", "best"]);
    const b = new Set(["scraping", "tools", "2026", "should"]);
    expect(jaccardSimilarity(a, b)).toBeCloseTo(3 / 5);
  });

  it("returns 0 for two empty sets", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });
});

describe("mergeClusters", () => {
  it("merges clusters across sources when title tokens overlap above the threshold", () => {
    const out = mergeClusters([
      { id: "a", title: "Best web scraping tools for 2026", cluster: "reddit" },
      { id: "b", title: "Web scraping tools you should try in 2026", cluster: "hackernews" },
      { id: "c", title: "Federal Reserve raises interest rates", cluster: "rss" },
    ]);
    const byId = new Map(out.map((o) => [o.id, o]));
    expect(byId.get("a")!.cluster).toBe(byId.get("b")!.cluster);
    expect(byId.get("a")!.cluster).toBe("hackernews"); // lexicographically smaller wins
    expect(byId.get("c")!.cluster).toBe("rss"); // unrelated, untouched
  });

  it("leaves clusters separate when overlap is below the threshold", () => {
    const out = mergeClusters([
      { id: "a", title: "Congress insider trading disclosures spike", cluster: "reddit" },
      { id: "b", title: "Best SaaS marketing growth playbook", cluster: "hackernews" },
    ]);
    const byId = new Map(out.map((o) => [o.id, o]));
    expect(byId.get("a")!.cluster).toBe("reddit");
    expect(byId.get("b")!.cluster).toBe("hackernews");
  });

  it("transitively merges a chain of similar clusters into one", () => {
    const out = mergeClusters([
      { id: "a", title: "Congressional insider trading tracker tools 2026", cluster: "reddit" },
      {
        id: "b",
        title: "Insider trading tracker tools for congress members",
        cluster: "hackernews",
      },
      { id: "c", title: "Congress members tracker for trading disclosures", cluster: "rss" },
    ]);
    const clusters = new Set(out.map((o) => o.cluster));
    expect(clusters.size).toBe(1);
  });

  it("treats a null cluster as 'unclustered'", () => {
    const out = mergeClusters([{ id: "a", title: "Some random title here", cluster: null }]);
    expect(out[0]!.cluster).toBe("unclustered");
  });

  it("is a no-op for signals already sharing a cluster", () => {
    const out = mergeClusters([
      { id: "a", title: "Congress insider trading", cluster: "congress-trades" },
      { id: "b", title: "Totally different topic here", cluster: "congress-trades" },
    ]);
    expect(out[0]!.cluster).toBe("congress-trades");
    expect(out[1]!.cluster).toBe("congress-trades");
  });
});

describe("applyAuthorCap", () => {
  it("keeps only the top-scored `cap` signals per author", () => {
    const items = [
      { id: "a", authorKey: "reddit:alice", score: 0.9 },
      { id: "b", authorKey: "reddit:alice", score: 0.5 },
      { id: "c", authorKey: "reddit:alice", score: 0.8 },
      { id: "d", authorKey: "reddit:alice", score: 0.3 },
      { id: "e", authorKey: "reddit:alice", score: 0.7 },
    ];
    const out = applyAuthorCap(items, 3);
    expect(out.map((o) => o.id)).toEqual(["a", "c", "e"]);
  });

  it("does not cap signals without an authorKey", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`,
      authorKey: null,
      score: 0.5,
    }));
    expect(applyAuthorCap(items, 3)).toHaveLength(5);
  });

  it("caps each author independently", () => {
    const items = [
      { id: "a1", authorKey: "x:alice", score: 0.9 },
      { id: "a2", authorKey: "x:alice", score: 0.8 },
      { id: "a3", authorKey: "x:alice", score: 0.7 },
      { id: "a4", authorKey: "x:alice", score: 0.6 },
      { id: "b1", authorKey: "x:bob", score: 0.5 },
      { id: "b2", authorKey: "x:bob", score: 0.4 },
    ];
    const out = applyAuthorCap(items, 3);
    expect(out.map((o) => o.id)).toEqual(["a1", "a2", "a3", "b1", "b2"]);
  });

  it("preserves original order of kept items even when score order differs", () => {
    const items = [
      { id: "a", authorKey: "x:alice", score: 0.7 },
      { id: "b", authorKey: "x:alice", score: 0.9 },
      { id: "c", authorKey: "x:alice", score: 0.5 }, // lowest, dropped
    ];
    expect(applyAuthorCap(items, 2).map((o) => o.id)).toEqual(["a", "b"]);
  });
});
