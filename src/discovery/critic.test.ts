import { describe, it, expect, vi } from "vitest";
import { makeClaudeCritic, makeOpenRouterCritic, neutralCritic, getCritic } from "./critic";
import type { ReasonerClient } from "./claudeReasoner";
import type { PostGenClient } from "@/publishing/postGenerator";

describe("neutralCritic", () => {
  it("passes drafts with a neutral score", async () => {
    const r = await neutralCritic.scoreDraft({
      title: "t",
      body: "b",
      lane: "content",
    });
    expect(r.score).toBe(4);
  });
});

describe("makeClaudeCritic", () => {
  it("averages the four criteria into a 1–5 score", async () => {
    const parse = vi.fn(async (..._args: unknown[]) => ({
      parsed_output: {
        sellability: 5,
        specificity: 4,
        novelty: 3,
        actionability: 4,
        notes: "solid but tighten the hook",
      },
    }));
    const client: ReasonerClient = { messages: { parse } };
    const critic = makeClaudeCritic({ client });
    const r = await critic.scoreDraft({ title: "t", body: "b", lane: "content" });
    expect(r.score).toBe(4); // (5+4+3+4)/4
    expect(r.notes).toContain("hook");
    expect(parse).toHaveBeenCalledTimes(1);
  });
});

describe("makeOpenRouterCritic", () => {
  it("averages the four criteria via the OpenRouter seam", async () => {
    const complete = vi.fn(async (..._args: unknown[]) => ({
      content: JSON.stringify({
        sellability: 5,
        specificity: 4,
        novelty: 3,
        actionability: 4,
        notes: "tighten the hook",
      }),
      usage: { prompt_tokens: 80, completion_tokens: 30 },
    }));
    const client: PostGenClient = { complete };
    const r = await makeOpenRouterCritic({ client }).scoreDraft({ title: "t", body: "b", lane: "content" });
    expect(r.score).toBe(4);
    expect(r.notes).toContain("hook");
    const body = (complete.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(body.model).toBe("deepseek/deepseek-v4-pro");
  });
});

describe("getCritic", () => {
  it("falls back to neutral without an API key", () => {
    expect(getCritic({})).toBe(neutralCritic);
  });

  it("prefers OpenRouter/DeepSeek when OPENROUTER_API_KEY is set", () => {
    const c = getCritic({ OPENROUTER_API_KEY: "k", ANTHROPIC_API_KEY: "a" });
    expect(c).not.toBe(neutralCritic);
    expect(typeof c.scoreDraft).toBe("function");
  });
});
