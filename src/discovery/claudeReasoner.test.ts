import { describe, it, expect, vi } from "vitest";
import type { Signal, Insight, Decision } from "@/db/schema";
import {
  makeClaudeReasoner,
  getReasoner,
  type ReasonerClient,
} from "./claudeReasoner";
import { deterministicReasoner } from "./reasoner";

// One superset object satisfies all three schemas (zod strips unknown keys).
const PARSED = {
  trend: "Congressional buys are front-running a sector rotation",
  importance: "high",
  whatChanged: "13F filings show concentrated buying",
  whyItMatters: "retail can mirror the flow",
  monetizableAngle: "a paid weekly 'smart-money tracker' newsletter",
  title: "Launch a Smart-Money Tracker newsletter",
  effort: "medium",
  rationale: "demand is proven",
  monetization: "$15/mo subscription",
  body: "# Smart-Money Tracker\n\n## This week...",
};

function fakeClient() {
  const parse = vi.fn(async (..._args: unknown[]) => ({
    parsed_output: { ...PARSED },
  }));
  const client: ReasonerClient = { messages: { parse } };
  return { client, parse };
}

const signal = (over: Partial<Signal> = {}): Signal => ({
  id: "s1",
  source: "rss",
  title: "Pelosi disclosure",
  url: "https://x/1",
  urlHash: "h1",
  author: "",
  publishedAt: "",
  raw: "bought NVDA calls",
  tags: [],
  score: 0.8,
  cluster: "congress trades",
  status: "new",
  capturedAt: "2026-01-01T00:00:00.000Z",
  runId: null,
  ...over,
});

describe("makeClaudeReasoner", () => {
  it("summarizes a cluster into a monetization-framed insight", async () => {
    const { client, parse } = fakeClient();
    const r = makeClaudeReasoner({ client, businessName: "Signal Desk" });
    const out = await r.summarizeCluster("congress trades", [signal()]);

    expect(out.importance).toBe("high");
    expect(out.trend).toContain("Congressional");
    expect(out.body).toContain("Monetizable angle:");
    // it actually called the model with a schema-constrained request
    expect(parse).toHaveBeenCalledTimes(1);
    const body = (parse.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(body.model).toBe("claude-opus-4-8");
    expect(body.output_config).toBeDefined();
  });

  it("proposes a decision that folds in the monetization plan", async () => {
    const { client } = fakeClient();
    const r = makeClaudeReasoner({ client });
    const out = await r.proposeDecision(
      { trend: "x", importance: "high", cluster: "c" } as Insight,
      "content",
    );
    expect(out.title).toContain("Smart-Money Tracker");
    expect(out.effort).toBe("medium");
    expect(out.rationale).toContain("Monetization:");
  });

  it("drafts a sellable asset", async () => {
    const { client } = fakeClient();
    const r = makeClaudeReasoner({ client, model: "claude-opus-4-8" });
    const out = await r.draftAsset({
      title: "Launch a Smart-Money Tracker newsletter",
      lane: "content",
      rationale: "r",
    } as Decision);
    expect(out.body).toContain("# Smart-Money Tracker");
  });
});

describe("getReasoner", () => {
  it("falls back to deterministic when no API key", () => {
    expect(getReasoner({}, {})).toBe(deterministicReasoner);
  });

  it("forces deterministic when DECODE_REASONER=deterministic", () => {
    expect(
      getReasoner({}, { ANTHROPIC_API_KEY: "k", DECODE_REASONER: "deterministic" }),
    ).toBe(deterministicReasoner);
  });
});
