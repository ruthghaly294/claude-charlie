import { describe, it, expect, vi } from "vitest";
import type { ResearchItem } from "@/research/last30days";
import { UsageMeter } from "@/discovery/usage";
import {
  makeOpenRouterGenerator,
  deterministicPostGenerator,
  getPostGenerator,
  PLATFORMS,
  type PostGenClient,
} from "./postGenerator";

const variant = (caption: string, hashtags: string[]) => ({ caption, hashtags });

const ASSET_PROMPT = "A vibrant illustration of AI coding agents collaborating.";

const GOOD = JSON.stringify({
  x: variant("Punchy take on the trend.", ["AICoding"]),
  reddit: variant("Honest long-form take, no hype.", ["ShouldBeDropped"]),
  instagram: variant("✨ Visual vibe here", ["AICoding", "DevTools", "BuildInPublic"]),
  facebook: variant("Friendly note for the feed.", ["AICoding"]),
  assetPrompt: ASSET_PROMPT,
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
  it("produces a tailored variant for every platform from a single call", async () => {
    const { client, complete } = fakeClient();
    const out = await makeOpenRouterGenerator({ client }).generatePosts({
      topic: "AI coding agents",
      items: [item()],
    });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(Object.keys(out.variants).sort()).toEqual([...PLATFORMS].sort());
    for (const p of PLATFORMS) {
      expect(out.variants[p].text).toContain("https://example.com/post/1");
    }
    expect(out.variants.x.text).toContain("Punchy take");
    expect(out.variants.x.text).toContain("#AICoding");
  });

  it("returns the model's asset plan prompt for a supplemental digital asset", async () => {
    const { client } = fakeClient();
    const out = await makeOpenRouterGenerator({ client }).generatePosts({
      topic: "AI coding agents",
      items: [item()],
    });
    expect(out.assetPrompt).toBe(ASSET_PROMPT);
  });

  it("omits hashtags from the Reddit variant", async () => {
    const { client } = fakeClient();
    const out = await makeOpenRouterGenerator({ client }).generatePosts({
      topic: "AI coding agents",
      items: [item()],
    });
    expect(out.variants.reddit.text).not.toContain("#");
    expect(out.variants.instagram.text).toContain("#");
  });

  it("defaults to deepseek/deepseek-v4-pro and requests json_schema output", async () => {
    const { client, complete } = fakeClient();
    await makeOpenRouterGenerator({ client }).generatePosts({
      topic: "x",
      items: [item()],
    });
    const body = (complete.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(body.model).toBe("deepseek/deepseek-v4-pro");
    const rf = body.response_format as { type?: string } | undefined;
    expect(rf?.type).toBe("json_schema");
  });

  it("honors an explicit model override", async () => {
    const { client, complete } = fakeClient();
    await makeOpenRouterGenerator({ client, model: "deepseek/deepseek-chat" }).generatePosts({
      topic: "x",
      items: [item()],
    });
    const body = (complete.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(body.model).toBe("deepseek/deepseek-chat");
  });

  it("records token usage on the meter", async () => {
    const { client } = fakeClient();
    const meter = new UsageMeter();
    await makeOpenRouterGenerator({ client, meter }).generatePosts({
      topic: "x",
      items: [item()],
    });
    expect(meter.totals.tokensIn).toBe(120);
    expect(meter.totals.tokensOut).toBe(60);
    expect(meter.totals.costUsd).toBeGreaterThan(0);
  });

  it("uses the Ali Abdaal voice by default in the system prompt", async () => {
    const { client, complete } = fakeClient();
    await makeOpenRouterGenerator({ client }).generatePosts({
      topic: "x",
      items: [item()],
    });
    const body = (complete.mock.calls[0]?.[0] ?? {}) as {
      messages?: { role: string; content: string }[];
    };
    const system = body.messages?.[0]?.content ?? "";
    expect(system).toContain("Ali Abdaal");
  });

  it("threads a custom voice and operator profile into the system prompt", async () => {
    const { client, complete } = fakeClient();
    await makeOpenRouterGenerator({
      client,
      voice: "dry and sardonic",
      businessName: "Signal Desk",
      profile: {
        goals: ["grow the newsletter"],
        weeklyHours: 10,
        skills: ["writing"],
        risk: "medium",
        monetizationTarget: "$5k/mo",
        audience: "indie hackers",
        voice: "",
      },
    }).generatePosts({ topic: "x", items: [item()] });
    const body = (complete.mock.calls[0]?.[0] ?? {}) as {
      messages?: { role: string; content: string }[];
    };
    const system = body.messages?.[0]?.content ?? "";
    expect(system).toContain("dry and sardonic");
    expect(system).toContain("indie hackers");
    expect(system).toContain("Signal Desk");
    expect(system).not.toContain("Ali Abdaal");
  });

  it("throws when the model returns output that violates the schema", async () => {
    const { client } = fakeClient(JSON.stringify({ x: { caption: 123 } }));
    await expect(
      makeOpenRouterGenerator({ client }).generatePosts({ topic: "x", items: [item()] }),
    ).rejects.toThrow();
  });

  it("synthesizes across multiple items, linking only the first item's url", async () => {
    const { client, complete } = fakeClient();
    const items = [
      item(),
      item({
        title: "A second related thread",
        url: "https://example.com/post/2",
        snippet: "More people weighing in.",
      }),
    ];
    const out = await makeOpenRouterGenerator({ client }).generatePosts({
      topic: "AI coding agents",
      items,
    });

    const body = (complete.mock.calls[0]?.[0] ?? {}) as {
      messages?: { role: string; content: string }[];
    };
    const prompt = body.messages?.[1]?.content ?? "";
    expect(prompt).toContain(items[0]!.title);
    expect(prompt).toContain(items[1]!.title);

    for (const p of PLATFORMS) {
      expect(out.variants[p].text).toContain(items[0]!.url);
      expect(out.variants[p].text).not.toContain(items[1]!.url);
    }
  });

  it("caps the X variant at 280 characters even when the model returns a long caption", async () => {
    const longContent = JSON.stringify({
      x: variant("y".repeat(400), ["AICoding"]),
      reddit: variant("Honest long-form take, no hype.", []),
      instagram: variant("✨ Visual vibe here", ["AICoding"]),
      facebook: variant("Friendly note for the feed.", ["AICoding"]),
      assetPrompt: ASSET_PROMPT,
    });
    const { client } = fakeClient(longContent);
    const out = await makeOpenRouterGenerator({ client }).generatePosts({
      topic: "AI coding agents",
      items: [item()],
    });
    expect(out.variants.x.text.length).toBeLessThanOrEqual(280);
    expect(out.variants.x.text).toContain(item().url);
    expect(out.variants.x.text).toContain("#AICoding");
  });
});

describe("deterministicPostGenerator", () => {
  it("produces a per-platform post containing the url with no network call", async () => {
    const out = await deterministicPostGenerator.generatePosts({
      topic: "AI coding agents",
      items: [item()],
    });
    for (const p of PLATFORMS) {
      expect(out.variants[p].text).toContain("https://example.com/post/1");
      expect(out.variants[p].text.length).toBeGreaterThan(0);
    }
    expect(out.variants.reddit.text).not.toContain("#");
  });

  it("produces a non-empty asset plan prompt referencing the topic", async () => {
    const out = await deterministicPostGenerator.generatePosts({
      topic: "AI coding agents",
      items: [item()],
    });
    expect(out.assetPrompt.length).toBeGreaterThan(0);
    expect(out.assetPrompt).toContain("AI coding agents");
  });

  it("synthesizes multiple items into one post, linking only the first item's url", async () => {
    const items = [
      item(),
      item({
        title: "A second related thread",
        url: "https://example.com/post/2",
        snippet: "More people weighing in.",
      }),
    ];
    const out = await deterministicPostGenerator.generatePosts({
      topic: "AI coding agents",
      items,
    });
    for (const p of PLATFORMS) {
      expect(out.variants[p].text).toContain(items[0]!.url);
      expect(out.variants[p].text).not.toContain(items[1]!.url);
      expect(out.variants[p].text).toContain(items[0]!.snippet);
      expect(out.variants[p].text).toContain(items[1]!.snippet);
    }
  });

  it("caps the X variant at 280 characters even with a long snippet", async () => {
    const longSnippet = "z".repeat(500);
    const longItem = item({ snippet: longSnippet });
    const out = await deterministicPostGenerator.generatePosts({
      topic: "AI coding agents",
      items: [longItem],
    });
    expect(out.variants.x.text.length).toBeLessThanOrEqual(280);
    expect(out.variants.x.text).toContain(longItem.url);
    expect(out.variants.x.text).toContain("#AIcodingagents");
    // other platforms are unaffected by the X-specific cap
    expect(out.variants.reddit.text).toContain(longSnippet);
  });

  it("caps the X variant at 280 characters when amalgamating long snippets", async () => {
    const items = [
      item({ snippet: "a".repeat(300) }),
      item({ url: "https://example.com/post/2", snippet: "b".repeat(300) }),
    ];
    const out = await deterministicPostGenerator.generatePosts({
      topic: "AI coding agents",
      items,
    });
    expect(out.variants.x.text.length).toBeLessThanOrEqual(280);
    expect(out.variants.x.text).toContain(items[0]!.url);
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
