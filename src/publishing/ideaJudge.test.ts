import { describe, it, expect, vi } from "vitest";
import type { Exemplar } from "@/research/exemplars";
import type { CreativeBrief } from "./creativeBrief";
import {
  makeOpenRouterIdeaJudge,
  deterministicIdeaJudge,
  getIdeaJudge,
  type IdeaJudgeClient,
} from "./ideaJudge";

const exemplar = (): Exemplar => ({
  source: "youtube",
  sourceUrl: "https://e/1",
  title: "I did 100 pushups a day",
  rankScore: 0.9,
  hookType: "transformation challenge",
  format: "reel",
  visualStyle: "before/after",
  pacing: "fast",
  onScreenTextStyle: "bold",
  cta: "subscribe",
  soundMood: "hype",
});

const brief = (): CreativeBrief => ({
  topic: "home workouts",
  hook: "I let AI plan my workouts for 30 days",
  shotList: [{ description: "hook", durationSec: 8 }],
  aspectRatio: "9:16",
  durationSec: 8,
  onScreenText: ["30 days"],
  caption: "the results shocked me",
  hashtags: ["homeworkouts"],
  soundMood: "hype",
  coverImagePrompt: "cover",
  videoPrompt: "vertical fast cuts",
});

const GOOD = JSON.stringify({
  score: 78,
  angle: "Lean into the 30-day transformation arc with a day-counter overlay",
  rationale: "Strong proven hook format; differentiated by the AI-planning angle",
  risks: "Saturated niche — needs a sharp first 2 seconds",
});

function fakeClient(content = GOOD) {
  const complete = vi.fn(async (..._args: unknown[]) => ({
    content,
    usage: { prompt_tokens: 150, completion_tokens: 80 },
  }));
  const client: IdeaJudgeClient = { complete };
  return { client, complete };
}

describe("makeOpenRouterIdeaJudge", () => {
  it("scores the planned brief against the trending exemplars in one call", async () => {
    const { client, complete } = fakeClient();
    const j = await makeOpenRouterIdeaJudge({ client }).judge({
      topic: "home workouts",
      exemplars: [exemplar()],
      brief: brief(),
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(j.score).toBe(78);
    expect(j.angle).toContain("30-day");
    expect(j.rationale).toBeTruthy();
  });

  it("clamps an out-of-range score into 0–100", async () => {
    const { client } = fakeClient(JSON.stringify({ score: 140, angle: "a", rationale: "r", risks: "" }));
    const j = await makeOpenRouterIdeaJudge({ client }).judge({ topic: "t", exemplars: [], brief: brief() });
    expect(j.score).toBe(100);
  });
});

describe("deterministicIdeaJudge", () => {
  it("proceeds with a neutral pass so offline/demo runs still flow", async () => {
    const j = await deterministicIdeaJudge.judge({ topic: "t", exemplars: [], brief: brief() });
    expect(j.score).toBeGreaterThanOrEqual(100);
    expect(j.angle).toBe(brief().hook);
  });
});

describe("getIdeaJudge", () => {
  it("falls back to deterministic without an OpenRouter key", () => {
    expect(getIdeaJudge({}, {})).toBe(deterministicIdeaJudge);
  });

  it("uses the LLM judge when OPENROUTER_API_KEY is set", () => {
    expect(getIdeaJudge({}, { OPENROUTER_API_KEY: "k" })).not.toBe(deterministicIdeaJudge);
  });
});
