import { describe, it, expect, vi } from "vitest";
import { makeOpenRouterCoverScorer, getCoverScorer } from "./coverScorer";
import type { CreativeBrief } from "./creativeBrief";
import type { PostGenClient } from "./postGenerator";

const brief = { topic: "ai tools", hook: "the one that saved me 10h" } as CreativeBrief;

function clientReturning(content: string): PostGenClient {
  return { complete: vi.fn(async () => ({ content, usage: undefined })) } as unknown as PostGenClient;
}

describe("makeOpenRouterCoverScorer", () => {
  it("sends the image as a vision part and returns the clamped score", async () => {
    const client = clientReturning(
      JSON.stringify({ score: 87, thumbStop: 90, clarity: 80, rationale: "strong" }),
    );
    const scorer = makeOpenRouterCoverScorer({ client });
    expect(await scorer.score("https://cdn/cover.png", brief)).toBe(87);

    const call = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const userParts = call.messages[1].content;
    expect(userParts.some((p: { type: string }) => p.type === "image_url")).toBe(true);
  });

  it("clamps out-of-range / non-finite scores to 0-100", async () => {
    expect(
      await makeOpenRouterCoverScorer({ client: clientReturning(JSON.stringify({ score: 250, thumbStop: 0, clarity: 0, rationale: "" })) }).score("u", brief),
    ).toBe(100);
    expect(
      await makeOpenRouterCoverScorer({ client: clientReturning(JSON.stringify({ score: -5, thumbStop: 0, clarity: 0, rationale: "" })) }).score("u", brief),
    ).toBe(0);
  });
});

describe("getCoverScorer", () => {
  it("returns undefined without keys, in deterministic mode, or without a vision model", () => {
    expect(getCoverScorer({})).toBeUndefined();
    expect(
      getCoverScorer({ OPENROUTER_API_KEY: "k", OPENROUTER_VISION_MODEL: "openai/gpt-4o-mini", DECODE_REASONER: "deterministic" }),
    ).toBeUndefined();
    // key present but no vision model ⇒ disabled (avoids 404s on a text-only base model)
    expect(getCoverScorer({ OPENROUTER_API_KEY: "k" })).toBeUndefined();
  });

  it("returns a scorer when a key and a vision model are present", () => {
    expect(getCoverScorer({ OPENROUTER_API_KEY: "k", OPENROUTER_VISION_MODEL: "openai/gpt-4o-mini" })).toBeDefined();
  });
});
