import { describe, it, expect, vi } from "vitest";
import type { ResearchItem } from "@/research/last30days";
import { UsageMeter } from "@/discovery/usage";
import {
  makeOpenRouterGenerator,
  deterministicPostGenerator,
  getPostGenerator,
  type PostGenClient,
} from "./postGenerator";

const GOOD = JSON.stringify({
  caption: "AI coding agents are quietly eating the boilerplate. Here's the shift nobody's pricing in.",
  hashtags: ["AICoding", "DevTools"],
});

function fakeClient(content = GOOD) {
  const complete = vi.fn(async (..._args: unknown[]) => ({
    content,
    usage: { prompt_tokens: 120, completion_tokens: 60 },
  }));
  const client: PostGenClient = { complete };
  return { client, complete };
}

const item = (over: Partial<ResearchItem> = {}): ResearchItem => ({
  title: "Cursor hits 1M users",
  url: "https://example.com/post/1",
  snippet: "Adoption is accelerating among solo devs.",
  engagement: { upvotes: 420, comments: 33 },
  ...over,
});

describe("makeOpenRouterGenerator", () => {
  it("synthesizes an original caption and appends the source url", async () => {
    const { client, complete } = fakeClient();
    const gen = makeOpenRouterGenerator({ client });
    const out = await gen.generatePost({ topic: "AI coding agents", item: item() });

    expect(out.text).toContain("quietly eating the boilerplate");
    expect(out.text).toContain("https://example.com/post/1");
    expect(out.text).toContain("#AICoding");
    expect(out.hashtags).toEqual(["AICoding", "DevTools"]);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("defaults to deepseek/deepseek-v4-pro and requests json_schema output", async () => {
    const { client, complete } = fakeClient();
    await makeOpenRouterGenerator({ client }).generatePost({
      topic: "AI coding agents",
      item: item(),
    });
    const body = (complete.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(body.model).toBe("deepseek/deepseek-v4-pro");
    const rf = body.response_format as { type?: string } | undefined;
    expect(rf?.type).toBe("json_schema");
  });

  it("honors an explicit model override", async () => {
    const { client, complete } = fakeClient();
    await makeOpenRouterGenerator({ client, model: "deepseek/deepseek-chat" }).generatePost({
      topic: "x",
      item: item(),
    });
    const body = (complete.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(body.model).toBe("deepseek/deepseek-chat");
  });

  it("records token usage on the meter", async () => {
    const { client } = fakeClient();
    const meter = new UsageMeter();
    await makeOpenRouterGenerator({ client, meter }).generatePost({
      topic: "x",
      item: item(),
    });
    expect(meter.totals.tokensIn).toBe(120);
    expect(meter.totals.tokensOut).toBe(60);
    expect(meter.totals.costUsd).toBeGreaterThan(0);
  });

  it("throws when the model returns output that violates the schema", async () => {
    const { client } = fakeClient(JSON.stringify({ caption: 123 }));
    await expect(
      makeOpenRouterGenerator({ client }).generatePost({ topic: "x", item: item() }),
    ).rejects.toThrow();
  });
});

describe("deterministicPostGenerator", () => {
  it("produces a post containing the url with no network call", async () => {
    const out = await deterministicPostGenerator.generatePost({
      topic: "AI coding agents",
      item: item(),
    });
    expect(out.text).toContain("https://example.com/post/1");
    expect(out.text.length).toBeGreaterThan(0);
  });
});

describe("getPostGenerator", () => {
  it("falls back to deterministic when no OPENROUTER_API_KEY", () => {
    expect(getPostGenerator({}, {})).toBe(deterministicPostGenerator);
  });

  it("forces deterministic when DECODE_REASONER=deterministic", () => {
    expect(
      getPostGenerator({}, { OPENROUTER_API_KEY: "k", DECODE_REASONER: "deterministic" }),
    ).toBe(deterministicPostGenerator);
  });

  it("returns an OpenRouter-backed generator when a key is present", () => {
    expect(getPostGenerator({}, { OPENROUTER_API_KEY: "k" })).not.toBe(
      deterministicPostGenerator,
    );
  });
});
