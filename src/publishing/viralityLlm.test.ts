import { describe, it, expect, vi } from "vitest";
import {
  makeOpenRouterBriefViralityScorer,
  deterministicBriefViralityScorer,
  getBriefViralityScorer,
} from "./viralityLlm";
import type { CreativeBrief } from "./creativeBrief";

const brief = (): CreativeBrief => ({
  topic: "AI coding agents",
  hook: "I let 7 AI agents run my workday",
  shotList: [{ description: "talking head", durationSec: 2 }],
  aspectRatio: "9:16",
  durationSec: 8,
  onScreenText: ["7 agents", "1 workday"],
  caption: "The one that saved me 3 hours.",
  hashtags: ["ai"],
  soundMood: "hype",
  coverImagePrompt: "x",
  videoPrompt: "y",
});

function fakeClient(content: string) {
  return {
    complete: vi.fn(async (_body: Record<string, unknown>) => ({
      content,
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })),
  };
}

describe("makeOpenRouterBriefViralityScorer", () => {
  it("returns a ViralityReport with a clamped score and a json breakdown", async () => {
    const client = fakeClient(
      JSON.stringify({
        score: 130,
        hookStrength: 88,
        retentionRisk: 20,
        captionLandsFact: true,
        rationale: "strong cold open",
      }),
    );
    const scorer = makeOpenRouterBriefViralityScorer({ client });
    const report = await scorer.score({ brief: brief() });

    expect(report.score).toBe(100); // clamped from 130
    expect(report.reportUrl).toBeNull();
    expect(JSON.parse(report.raw)).toMatchObject({ scorer: "llm", hookStrength: 88 });
  });

  it("sends the brief's hook and caption to the model", async () => {
    const client = fakeClient(
      JSON.stringify({ score: 50, hookStrength: 50, retentionRisk: 50, captionLandsFact: false, rationale: "" }),
    );
    const scorer = makeOpenRouterBriefViralityScorer({ client });
    await scorer.score({ brief: brief() });

    const body = client.complete.mock.calls[0]![0] as { messages: { content: string }[] };
    const user = body.messages[1]!.content;
    expect(user).toContain("I let 7 AI agents run my workday");
    expect(user).toContain("The one that saved me 3 hours.");
  });
});

describe("deterministicBriefViralityScorer", () => {
  it("returns an unknown score so the gate routes to draft", async () => {
    const report = await deterministicBriefViralityScorer.score({ brief: brief() });
    expect(report.score).toBeNull();
  });
});

describe("getBriefViralityScorer", () => {
  it("falls back to deterministic without keys", async () => {
    const scorer = getBriefViralityScorer({});
    expect(await scorer.score({ brief: brief() })).toMatchObject({ score: null });
  });
});
