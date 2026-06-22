import type { DB } from "@/db/client";
import type { DecodeConfig } from "@/discovery/config";
import { runLast30Days } from "@/research/last30days";
import { rankReport } from "@/research/rank";
import {
  buildTrendImitationDeps,
  type TrendImitationDeps,
  type TrendStage,
} from "./runTrendImitation";
import { passthroughHost } from "./mediaHost";

export type TrendRunMode = "demo" | "dry-run" | "live";

export type StageHook = (stage: TrendStage, data: unknown) => void;

/** Fully-canned sample data — instant, free, no network/keys. Shows the pipeline shape. */
export function demoDeps(onStage?: StageHook): TrendImitationDeps {
  let n = 0;
  return {
    research: async (topic) => ({
      topic,
      rangeFrom: "",
      rangeTo: "",
      itemsBySource: {},
      errorsBySource: {},
      warnings: [],
      topPicks: [
        { title: `I tried 7 ${topic} tools in 7 days`, url: "https://youtube.com/v/1", snippet: "fast hook, big payoff", engagement: { views: 1_200_000 }, source: "youtube", score: 0.94, cluster: topic },
        { title: `The ${topic} setup that saved me 10 hours`, url: "https://tiktok.com/v/2", snippet: "before/after reveal", engagement: { views: 800_000 }, source: "tiktok", score: 0.89, cluster: topic },
      ],
    }),
    extractor: {
      extract: async () => [
        { source: "youtube", sourceUrl: "https://youtube.com/v/1", title: "I tried 7 tools", rankScore: 0.94, hookType: "first-person experiment", format: "reel", visualStyle: "talking head + fast screen-recording b-roll", pacing: "1–2s cuts", onScreenTextStyle: "bold keyword captions", cta: "follow for part 2", soundMood: "upbeat" },
        { source: "tiktok", sourceUrl: "https://tiktok.com/v/2", title: "setup that saved me 10h", rankScore: 0.89, hookType: "before/after reveal", format: "reel", visualStyle: "POV desk, snappy zooms", pacing: "punchy", onScreenTextStyle: "big numbers", cta: "save this", soundMood: "hype" },
      ],
    },
    findSounds: async (topic) => [
      { topic, title: "Aesthetic phonk (sped up)", url: "https://tiktok.com/sound/1", whereTrending: "tiktok", engagement: 92_000, mood: "hype", energy: "high" },
      { topic, title: "Lofi chill beat", url: "https://tiktok.com/sound/2", whereTrending: "reels", engagement: 41_000, mood: "chill", energy: "low" },
    ],
    mapTrack: (t) => ({ mood: t.mood, energy: t.energy, provider: t.mood === "chill" ? "pixabay" : "uppbeat", searchQuery: `${t.mood} ${t.energy} energy royalty-free`, licence: "royalty-free", trackUrl: null, embeddable: false, note: "use royalty-free match or add platform sound in-app" }),
    briefBuilder: {
      build: async ({ topic, soundMood }) => ({
        topic,
        hook: `I let AI run my ${topic} for a week — here's what broke`,
        shotList: [
          { description: "punch-in talking head: the hook line", durationSec: 2 },
          { description: "fast screen-recording montage of the tools working", durationSec: 4 },
          { description: "reaction + the surprising winner", durationSec: 2 },
        ],
        aspectRatio: "9:16",
        durationSec: 8,
        onScreenText: [`7 ${topic} tools`, "1 week", "the winner ➜"],
        caption: `The one that actually saved me hours. Save this for later 👇`,
        hashtags: [topic.replace(/[^a-z0-9]+/gi, ""), "productivity", "tools"],
        soundMood: soundMood ?? "hype",
        coverImagePrompt: `clean high-contrast vertical cover about ${topic}, mobile-first, no text`,
        videoPrompt: `fast-cut vertical 9:16 short about ${topic}, punchy zoom transitions, bright modern UI screens, ${soundMood ?? "hype"} energy`,
      }),
    },
    judge: {
      judge: async ({ brief }) => ({
        score: 82,
        angle: brief.hook,
        rationale: "demo: strong proven hook, clear payoff, on-brand",
        risks: "saturated niche — nail the first 2 seconds",
      }),
    },
    media: {
      configured: true,
      generateAsset: async () => ({ url: "https://demo.local/cover-frame.png", type: "image" }),
      generateVideo: async () => ({ url: "https://demo.local/generated-reel.mp4", type: "video" }),
    },
    mediaHost: passthroughHost,
    scoreVideo: async () => ({ score: 81, reportUrl: "https://demo.local/virality-report", raw: "Overall: 81" }),
    buffer: { configured: false } as unknown as TrendImitationDeps["buffer"],
    now: () => new Date().toISOString(),
    id: () => `demo-${++n}`,
    onStage,
  };
}

/** Real trending research + deterministic recipes, but stub the paid media steps. */
export function dryRunDeps(
  config: DecodeConfig,
  env: Record<string, string | undefined>,
  onStage?: StageHook,
  db?: DB,
): TrendImitationDeps {
  env.DECODE_REASONER = "deterministic"; // free: no LLM key needed
  const real = buildTrendImitationDeps(config, env, db);
  let n = 0;
  return {
    ...real,
    // Keep dry-run free/hermetic — never call the real NotebookLM CLI or scrape pages.
    notebookInsight: undefined,
    webResearchInsight: undefined,
    research: async (topic) => {
      const raw = await runLast30Days(topic, { quick: true });
      return rankReport(raw, {
        keywords: config.keywords,
        multipliers: {},
        weights: config.research.rankWeights,
        halfLifeDays: config.research.halfLifeDays,
        topN: config.research.topN,
      });
    },
    media: {
      configured: true,
      generateAsset: async () => ({ url: "https://dry-run.local/cover.png", type: "image" }),
      generateVideo: async () => ({ url: "https://dry-run.local/clip.mp4", type: "video" }),
    },
    scoreVideo: async () => ({ score: 75, reportUrl: null, raw: "(dry-run: video not scored)" }),
    buffer: { configured: false } as unknown as TrendImitationDeps["buffer"],
    id: () => `dry-${++n}`,
    onStage,
  };
}

/** Resolve deps for a run mode. `live` uses real research/LLM/Higgsfield/Buffer. */
export function buildModeDeps(
  mode: TrendRunMode,
  config: DecodeConfig,
  env: Record<string, string | undefined>,
  onStage?: StageHook,
  db?: DB,
): TrendImitationDeps {
  if (mode === "demo") return demoDeps(onStage);
  if (mode === "dry-run") return dryRunDeps(config, env, onStage, db);
  const live = buildTrendImitationDeps(config, env, db);
  live.onStage = onStage;
  return live;
}
