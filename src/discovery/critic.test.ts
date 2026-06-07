import { describe, it, expect, vi } from "vitest";
import { makeClaudeCritic, neutralCritic, getCritic } from "./critic";
import type { ReasonerClient } from "./claudeReasoner";

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

describe("getCritic", () => {
  it("falls back to neutral without an API key", () => {
    expect(getCritic({})).toBe(neutralCritic);
  });
});
