import { describe, it, expect, vi } from "vitest";
import type { ResearchReport } from "./last30days";
import {
  findTrendingSounds,
  makeSoundTrend,
  SOUND_QUERIES,
  type SoundTrend,
} from "./musicTrends";

const report = (over: Partial<ResearchReport> = {}): ResearchReport => ({
  topic: "x",
  rangeFrom: "2026-05-16",
  rangeTo: "2026-06-15",
  itemsBySource: {},
  errorsBySource: {},
  warnings: [],
  ...over,
});

describe("findTrendingSounds", () => {
  it("runs the sound-trend queries and maps items into SoundTrend candidates", async () => {
    const runner = vi.fn(async (query: string) =>
      report({
        topic: query,
        itemsBySource: {
          tiktok: [
            {
              title: "Upbeat phonk sound trending on productivity videos",
              url: "https://tiktok.com/sound/1",
              snippet: "high energy hype beat used in 40k videos",
              engagement: { videos: 40_000 },
            },
          ],
        },
      }),
    );

    const sounds = await findTrendingSounds("productivity", { runner });

    expect(runner).toHaveBeenCalledTimes(SOUND_QUERIES.length);
    expect(sounds.length).toBeGreaterThan(0);
    expect(sounds[0]).toMatchObject({
      topic: "productivity",
      url: "https://tiktok.com/sound/1",
      energy: "high",
    });
    expect(sounds[0]!.engagement).toBe(40_000);
  });

  it("dedupes the same sound seen across multiple queries and sorts by engagement", async () => {
    const dup = {
      title: "Same viral sound",
      url: "https://tiktok.com/sound/dup",
      snippet: "chill lofi",
      engagement: { videos: 100 },
    };
    const big = {
      title: "Bigger sound",
      url: "https://tiktok.com/sound/big",
      snippet: "epic cinematic",
      engagement: { videos: 9_999 },
    };
    const runner = vi.fn(async () =>
      report({ itemsBySource: { tiktok: [dup], reels: [dup, big] } }),
    );

    const sounds = await findTrendingSounds("topic", { runner, limit: 10 });
    const urls = sounds.map((s) => s.url);
    expect(urls.filter((u) => u === "https://tiktok.com/sound/dup")).toHaveLength(1);
    expect(sounds[0]!.url).toBe("https://tiktok.com/sound/big");
  });

  it("respects the limit", async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      title: `sound ${i}`,
      url: `https://s/${i}`,
      snippet: "",
      engagement: { videos: i },
    }));
    const runner = vi.fn(async () => report({ itemsBySource: { tiktok: items } }));
    const sounds = await findTrendingSounds("t", { runner, limit: 5 });
    expect(sounds).toHaveLength(5);
  });

  it("ranks real-chart (tiktokRunner) sounds ahead of higher-engagement text sounds", async () => {
    const runner = vi.fn(async () =>
      report({
        itemsBySource: {
          tiktok: [
            {
              title: "Inferred text sound",
              url: "https://text/1",
              snippet: "",
              engagement: { videos: 1_000_000 },
            },
          ],
        },
      }),
    );
    const real: SoundTrend = makeSoundTrend("t", "tiktok_sounds", {
      title: "Real Song — Real Artist",
      url: "https://www.tiktok.com/music/123",
      engagement: 50,
    });
    const tiktokRunner = vi.fn(async () => [real]);

    const sounds = await findTrendingSounds("t", { runner, tiktokRunner });

    expect(tiktokRunner).toHaveBeenCalledWith("t");
    expect(sounds[0]).toMatchObject({
      whereTrending: "tiktok_sounds",
      title: "Real Song — Real Artist",
    });
    expect(sounds[1]?.url).toBe("https://text/1");
  });

  it("falls back to text sounds when the real-chart runner throws", async () => {
    const runner = vi.fn(async () =>
      report({
        itemsBySource: {
          tiktok: [
            { title: "Text sound", url: "https://text/1", snippet: "", engagement: { v: 5 } },
          ],
        },
      }),
    );
    const tiktokRunner = vi.fn(async () => {
      throw new Error("403 from datacenter IP");
    });

    const sounds = await findTrendingSounds("t", { runner, tiktokRunner });
    expect(sounds).toHaveLength(1);
    expect(sounds[0]?.url).toBe("https://text/1");
  });
});

describe("makeSoundTrend", () => {
  it("infers mood/energy from text when provided, else from the title", () => {
    expect(makeSoundTrend("t", "tiktok_sounds", {
      title: "Some Song",
      url: "u",
      engagement: 9,
      text: "epic cinematic trailer",
    })).toMatchObject({ mood: "epic", energy: "high" });

    expect(
      makeSoundTrend("t", "tiktok_sounds", { title: "chill lofi beat", url: "u", engagement: 1 }),
    ).toMatchObject({ mood: "chill", energy: "low" });
  });

  it("carries the native sound id and author when supplied", () => {
    const trend = makeSoundTrend("t", "tiktok_sounds", {
      title: "phonk house — nightdrive",
      url: "https://www.tiktok.com/music/123",
      engagement: 9,
      soundId: "123",
      author: "nightdrive",
    });
    expect(trend.soundId).toBe("123");
    expect(trend.author).toBe("nightdrive");
  });

  it("omits sound id and author for text-inferred sounds", () => {
    const trend = makeSoundTrend("t", "reddit", {
      title: "some discussion",
      url: "u",
      engagement: 1,
    });
    expect(trend.soundId).toBeUndefined();
    expect(trend.author).toBeUndefined();
  });
});
