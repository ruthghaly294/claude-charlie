import { describe, it, expect } from "vitest";
import { deterministicReasoner } from "./reasoner";
import type { Signal, Insight, Decision } from "@/db/schema";

function sig(over: Partial<Signal> = {}): Signal {
  return {
    id: "s1",
    source: "rss",
    title: "A signal",
    url: "https://x/1",
    urlHash: "h1",
    author: "",
    publishedAt: "",
    raw: "",
    tags: [],
    score: 0.5,
    cluster: "radiology",
    status: "new",
    capturedAt: "2026-01-01T00:00:00.000Z",
    runId: null,
    ...over,
  };
}

function insight(over: Partial<Insight> = {}): Insight {
  return {
    id: "insight:radiology",
    cluster: "radiology",
    trend: "radiology trend",
    importance: "high",
    body: "",
    evidence: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function decision(over: Partial<Decision> = {}): Decision {
  return {
    id: "decision:insight:radiology",
    lane: "content",
    title: "Publish content on radiology",
    impact: "high",
    effort: "low",
    confidence: "high",
    value: 300,
    priority: 10,
    rationale: "",
    fromInsights: ["insight:radiology"],
    status: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("deterministicReasoner.summarizeCluster", () => {
  it("rates a large, high-scoring cluster as high importance", async () => {
    const out = await deterministicReasoner.summarizeCluster("radiology", [
      sig({ id: "a", score: 0.8 }),
      sig({ id: "b", score: 0.9 }),
      sig({ id: "c", score: 0.7 }),
    ]);
    expect(out.importance).toBe("high");
    expect(out.trend).toContain("radiology");
    expect(out.body).toContain("What changed");
    expect(out.body).toContain("Recommended action");
  });

  it("rates a single weak signal as low importance", async () => {
    const out = await deterministicReasoner.summarizeCluster("misc", [
      sig({ id: "a", cluster: "misc", score: 0.1 }),
    ]);
    expect(out.importance).toBe("low");
  });

  it("rates a moderate cluster as medium importance", async () => {
    const out = await deterministicReasoner.summarizeCluster("frcr", [
      sig({ id: "a", cluster: "frcr", score: 0.5 }),
      sig({ id: "b", cluster: "frcr", score: 0.5 }),
    ]);
    expect(out.importance).toBe("medium");
  });
});

describe("deterministicReasoner.proposeDecision", () => {
  it("produces a lane-appropriate imperative title and rationale citing the insight", async () => {
    const out = await deterministicReasoner.proposeDecision(
      insight({ trend: "rising radiology interest" }),
      "product",
    );
    expect(out.title.toLowerCase()).toContain("radiology");
    expect(out.rationale).toContain("rising radiology interest");
    expect(out.effort).toBe("high"); // product is a high-effort lane
  });

  it("treats content as a low-effort lane", async () => {
    const out = await deterministicReasoner.proposeDecision(insight(), "content");
    expect(out.effort).toBe("low");
  });
});

describe("deterministicReasoner.draftAsset", () => {
  it("drafts a content outline for the content lane", async () => {
    const out = await deterministicReasoner.draftAsset(
      decision({ lane: "content" }),
    );
    expect(out.title).toBe("Publish content on radiology");
    expect(out.body).toContain("Outline");
  });

  it("drafts a spec for the product lane", async () => {
    const out = await deterministicReasoner.draftAsset(
      decision({ lane: "product", title: "Build a radiology feature" }),
    );
    expect(out.body.toLowerCase()).toContain("user stories");
  });
});
