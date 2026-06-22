import { describe, it, expect, vi } from "vitest";
import type { Exemplar } from "@/research/exemplars";
import {
  makeOpenRouterBriefBuilder,
  deterministicBriefBuilder,
  getBriefBuilder,
  type BriefGenClient,
} from "./creativeBrief";

const exemplar = (over: Partial<Exemplar> = {}): Exemplar => ({
  source: "youtube",
  sourceUrl: "https://e/1",
  title: "I tried 7 AI agents",
  rankScore: 0.9,
  hookType: "first-person experiment",
  format: "reel",
  visualStyle: "talking head + b-roll",
  pacing: "rapid cuts",
  onScreenTextStyle: "bold captions",
  cta: "follow for part 2",
  soundMood: "hype",
  ...over,
});

const GOOD = JSON.stringify({
  hook: "I let 7 AI agents run my workday — here's what broke",
  shotList: [
    { description: "punch-in talking head, hook line", durationSec: 2 },
    { description: "screen-recording montage of agents working", durationSec: 4 },
    { description: "reaction + payoff", durationSec: 2 },
  ],
  onScreenText: ["7 AI agents", "1 workday", "the winner ➜"],
  caption: "The one that actually saved me 3 hours.",
  hashtags: ["AIagents", "productivity"],
  soundMood: "hype",
  coverImagePrompt: "split-screen of seven glowing agent avatars, high contrast",
  videoPrompt: "fast-cut vertical montage, punchy zoom transitions, bright UI screens",
});

function fakeClient(content = GOOD) {
  const complete = vi.fn(async (..._args: unknown[]) => ({
    content,
    usage: { prompt_tokens: 200, completion_tokens: 120 },
  }));
  const client: BriefGenClient = { complete };
  return { client, complete };
}

describe("makeOpenRouterBriefBuilder", () => {
  it("synthesizes a vertical short-form brief from the exemplars in one call", async () => {
    const { client, complete } = fakeClient();
    const brief = await makeOpenRouterBriefBuilder({ client }).build({
      topic: "AI coding agents",
      exemplars: [exemplar()],
      soundMood: "hype",
    });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(brief.topic).toBe("AI coding agents");
    expect(brief.aspectRatio).toBe("9:16");
    expect(brief.shotList).toHaveLength(3);
    expect(brief.durationSec).toBe(8);
    expect(brief.videoPrompt).toContain("vertical");
    expect(brief.hashtags).toContain("AIagents");
  });

  it("honors an aspect-ratio override", async () => {
    const { client } = fakeClient();
    const brief = await makeOpenRouterBriefBuilder({ client, aspectRatio: "1:1" }).build({
      topic: "t",
      exemplars: [exemplar()],
    });
    expect(brief.aspectRatio).toBe("1:1");
  });

  it("feeds operator-pasted research into the brief prompt as a factual payload", async () => {
    const { client, complete } = fakeClient();
    await makeOpenRouterBriefBuilder({ client }).build({
      topic: "AI coding agents",
      exemplars: [exemplar()],
      manualResearch: "Internal benchmark: agent X cut PR review time 42% across 600 repos.",
    });
    const userMsg = (complete.mock.calls[0]![0] as { messages: { role: string; content: string }[] })
      .messages.find((m) => m.role === "user")!.content;
    expect(userMsg).toContain("Operator-provided research");
    expect(userMsg).toContain("cut PR review time 42%");
  });
});

describe("deterministicBriefBuilder", () => {
  it("builds a usable brief offline from the top exemplar", async () => {
    const brief = await deterministicBriefBuilder.build({
      topic: "AI coding agents",
      exemplars: [exemplar()],
    });
    expect(brief.hook).toBeTruthy();
    expect(brief.shotList.length).toBeGreaterThan(0);
    expect(brief.durationSec).toBe(brief.shotList.reduce((s, sh) => s + sh.durationSec, 0));
    expect(brief.coverImagePrompt).toContain("AI coding agents");
  });

  it("still produces a brief when there are no exemplars", async () => {
    const brief = await deterministicBriefBuilder.build({ topic: "gardening", exemplars: [] });
    expect(brief.shotList.length).toBeGreaterThan(0);
  });
});

describe("getBriefBuilder", () => {
  it("falls back to deterministic without an OpenRouter key", () => {
    expect(getBriefBuilder({}, {})).toBe(deterministicBriefBuilder);
  });
});
