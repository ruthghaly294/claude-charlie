import { describe, it, expect, vi } from "vitest";
import type { RankedReport, RankedItem } from "./rank";
import {
  makeOpenRouterExemplarExtractor,
  deterministicExemplarExtractor,
  getExemplarExtractor,
  type ExemplarExtractClient,
} from "./exemplars";

const pick = (over: Partial<RankedItem> = {}): RankedItem => ({
  title: "I tried 7 AI agents for a week",
  url: "https://example.com/v/1",
  snippet: "Surprising winner with a fast hook in the first 2 seconds.",
  engagement: { views: 120_000, likes: 9_000 },
  source: "youtube",
  score: 0.82,
  cluster: "ai-agents",
  ...over,
});

const report = (picks: RankedItem[]): RankedReport => ({
  topic: "AI coding agents",
  rangeFrom: "2026-05-16",
  rangeTo: "2026-06-15",
  itemsBySource: {},
  errorsBySource: {},
  warnings: [],
  topPicks: picks,
});

const GOOD = JSON.stringify({
  exemplars: [
    {
      hookType: "first-person experiment",
      format: "reel",
      visualStyle: "fast talking-head with b-roll cutaways",
      pacing: "rapid cuts, 1-2s per shot",
      onScreenTextStyle: "bold captions, one keyword per line",
      cta: "follow for part 2",
      soundMood: "upbeat electronic",
    },
  ],
});

function fakeClient(content = GOOD) {
  const complete = vi.fn(async (..._args: unknown[]) => ({
    content,
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  }));
  const client: ExemplarExtractClient = { complete };
  return { client, complete };
}

describe("exemplar vision behavior", () => {
  const visionReport = report([pick({ imageUrl: "https://img/thumb.jpg" })]);

  it("sends images to the vision model only when one is configured", async () => {
    const { client, complete } = fakeClient();
    const extractor = makeOpenRouterExemplarExtractor({
      client,
      model: "owl-alpha",
      visionModel: "openai/gpt-4o-mini",
      vision: true,
    });
    await extractor.extract(visionReport);
    const call = complete.mock.calls[0]![0] as { model: string; messages: { content: unknown }[] };
    expect(call.model).toBe("openai/gpt-4o-mini");
    expect(Array.isArray(call.messages[1]!.content)).toBe(true);
  });

  it("stays text-only on the base model when no vision model is configured", async () => {
    const { client, complete } = fakeClient();
    const extractor = makeOpenRouterExemplarExtractor({ client, model: "owl-alpha", vision: true });
    await extractor.extract(visionReport);
    const call = complete.mock.calls[0]![0] as { model: string; messages: { content: unknown }[] };
    expect(call.model).toBe("owl-alpha");
    expect(typeof call.messages[1]!.content).toBe("string");
  });

  it("falls back to a text-only call on the base model when the vision call fails", async () => {
    const complete = vi
      .fn(async (..._args: unknown[]) => ({ content: GOOD, usage: undefined }))
      .mockRejectedValueOnce(new Error("404 No endpoints found that support image input"));
    const extractor = makeOpenRouterExemplarExtractor({
      client: { complete } as ExemplarExtractClient,
      model: "owl-alpha",
      visionModel: "openai/gpt-4o-mini",
      vision: true,
    });
    const out = await extractor.extract(visionReport);
    expect(out).toHaveLength(1); // survived
    expect(complete).toHaveBeenCalledTimes(2);
    const retry = complete.mock.calls[1]![0] as { model: string; messages: { content: unknown }[] };
    expect(retry.model).toBe("owl-alpha");
    expect(typeof retry.messages[1]!.content).toBe("string");
  });
});

describe("makeOpenRouterExemplarExtractor", () => {
  it("infers a structured pattern per top pick in a single call", async () => {
    const { client, complete } = fakeClient();
    const out = await makeOpenRouterExemplarExtractor({ client }).extract(report([pick()]));

    expect(complete).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: "youtube",
      sourceUrl: "https://example.com/v/1",
      hookType: "first-person experiment",
      format: "reel",
      soundMood: "upbeat electronic",
    });
    expect(out[0]!.rankScore).toBe(0.82);
  });

  it("limits extraction to topN picks", async () => {
    const { client } = fakeClient(
      JSON.stringify({ exemplars: [GOOD, GOOD].map((_, i) => JSON.parse(GOOD).exemplars[0]) }),
    );
    const picks = [pick({ url: "https://e/1" }), pick({ url: "https://e/2" }), pick({ url: "https://e/3" })];
    const out = await makeOpenRouterExemplarExtractor({ client, topN: 2 }).extract(report(picks));
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it("returns an empty list when there are no top picks (no LLM call)", async () => {
    const { client, complete } = fakeClient();
    const out = await makeOpenRouterExemplarExtractor({ client }).extract(report([]));
    expect(out).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("deterministicExemplarExtractor", () => {
  it("derives a serviceable exemplar from the pick itself with no network", async () => {
    const out = await deterministicExemplarExtractor.extract(report([pick()]));
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceUrl).toBe("https://example.com/v/1");
    expect(out[0]!.format).toBeTruthy();
  });
});

describe("getExemplarExtractor", () => {
  it("uses the deterministic extractor when no OpenRouter key is present", () => {
    expect(getExemplarExtractor({}, {})).toBe(deterministicExemplarExtractor);
  });

  it("forces deterministic when DECODE_REASONER=deterministic even with a key", () => {
    expect(
      getExemplarExtractor({}, { OPENROUTER_API_KEY: "k", DECODE_REASONER: "deterministic" }),
    ).toBe(deterministicExemplarExtractor);
  });
});
