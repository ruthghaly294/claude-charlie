import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type DB } from "@/db/client";
import { generatedVideos, musicTracks, trendRuns } from "@/db/schema";
import { parseConfig, type DecodeConfig } from "@/discovery/config";
import type { RankedReport } from "@/research/rank";
import type { Exemplar } from "@/research/exemplars";
import type { SoundTrend } from "@/research/musicTrends";
import type { SafeTrack } from "@/research/royaltyFreeMap";
import type { CreativeBrief } from "./creativeBrief";
import type { HiggsfieldClient } from "./higgsfieldClient";
import type { BufferClient, BufferPost } from "./bufferClient";
import {
  runTrendImitation,
  runSingleTrendRun,
  runTrendRenderResume,
  buildTiktokSoundRunner,
  type TrendImitationDeps,
  type RenderContext,
} from "./runTrendImitation";
import { applyMediaOverride } from "./mediaProvider";

const rankedReport = (): RankedReport => ({
  topic: "AI coding agents",
  rangeFrom: "2026-05-16",
  rangeTo: "2026-06-15",
  itemsBySource: {},
  errorsBySource: {},
  warnings: [],
  topPicks: [],
});

const exemplar = (): Exemplar => ({
  source: "youtube",
  sourceUrl: "https://e/1",
  title: "I tried 7 AI agents",
  rankScore: 0.9,
  hookType: "experiment",
  format: "reel",
  visualStyle: "talking head",
  pacing: "rapid",
  onScreenTextStyle: "bold",
  cta: "follow",
  soundMood: "hype",
});

const sound = (over: Partial<SoundTrend> = {}): SoundTrend => ({
  topic: "AI coding agents",
  title: "viral sound",
  url: "https://tiktok.com/s/1",
  whereTrending: "tiktok",
  engagement: 5000,
  mood: "hype",
  energy: "high",
  ...over,
});

const safeTrack = (over: Partial<SafeTrack> = {}): SafeTrack => ({
  mood: "hype",
  energy: "high",
  provider: "pixabay",
  searchQuery: "hype high energy",
  licence: "royalty-free",
  trackUrl: null,
  embeddable: false,
  note: "n/a",
  ...over,
});

const brief = (): CreativeBrief => ({
  topic: "AI coding agents",
  hook: "hook",
  shotList: [{ description: "a", durationSec: 8 }],
  aspectRatio: "9:16",
  durationSec: 8,
  onScreenText: ["a"],
  caption: "great take",
  hashtags: ["AIagents"],
  soundMood: "hype",
  coverImagePrompt: "cover",
  videoPrompt: "vertical fast cuts",
});

function fakeHiggsfield(): HiggsfieldClient {
  return {
    configured: true,
    generateAsset: vi.fn(async () => ({ url: "https://cdn/cover.png", type: "image" as const })),
    generateVideo: vi.fn(async () => ({ url: "https://cdn/clip.mp4", type: "video" as const })),
  };
}

function fakeBuffer(): BufferClient {
  const post: BufferPost = {
    id: "buf-1",
    status: "draft",
    text: "great take",
    dueAt: null,
    sentAt: null,
    channelId: "ig-1",
    channelService: "instagram",
    error: null,
    metrics: [],
    metricsUpdatedAt: null,
    imageUrl: null,
    imageUrls: [],
  };
  return {
    configured: true,
    getAccount: vi.fn(),
    listChannels: vi.fn(),
    listPosts: vi.fn(),
    createPost: vi.fn(async () => post),
    deletePost: vi.fn(),
    retryPost: vi.fn(),
  } as unknown as BufferClient;
}

function makeDeps(over: Partial<TrendImitationDeps> = {}): TrendImitationDeps {
  return {
    research: vi.fn(async () => rankedReport()),
    extractor: { extract: vi.fn(async () => [exemplar()]) },
    findSounds: vi.fn(async () => [sound({ engagement: 5000 }), sound({ url: "https://t/2", engagement: 1 })]),
    mapTrack: vi.fn((t: SoundTrend) => safeTrack({ mood: t.mood })),
    briefBuilder: { build: vi.fn(async () => brief()) },
    judge: { judge: vi.fn(async () => ({ score: 80, angle: "a", rationale: "r", risks: "" })) },
    media: fakeHiggsfield(),
    mediaHost: { persist: vi.fn(async (url: string) => url) },
    scoreVideo: vi.fn(async () => ({ score: 85, reportUrl: "https://r/1", raw: "Overall: 85" })),
    buffer: fakeBuffer(),
    now: () => "2026-06-15T00:00:00.000Z",
    id: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
    ...over,
  };
}

function configWithChannel(): DecodeConfig {
  const c = parseConfig({});
  c.publishing.channelsByPlatform = { instagram: "ig-1" };
  c.trendImitation.saveToDraft = false;
  c.trendImitation.scoreVirality = true; // these tests exercise the scoring + gate path
  return c;
}

describe("runTrendImitation", () => {
  it("runs the full imitate→innovate pipeline and persists artifacts", async () => {
    const db: DB = createDb(":memory:");
    const deps = makeDeps();
    const result = await runTrendImitation(db, configWithChannel(), "AI coding agents", deps);

    expect(deps.research).toHaveBeenCalledWith("AI coding agents");
    expect(result.videoUrl).toBe("https://cdn/clip.mp4");
    expect(result.viralityScore).toBe(85);
    expect(result.passed).toBe(true);

    const sounds = db.select().from(musicTracks).all();
    expect(sounds.length).toBe(2);

    const videos = db.select().from(generatedVideos).all();
    expect(videos).toHaveLength(1);
    expect(videos[0]!.videoUrl).toBe("https://cdn/clip.mp4");
    expect(videos[0]!.viralityScore).toBe(85);
  });

  it("best-of-N: renders multiple covers, scores them, and animates the winner", async () => {
    const db: DB = createDb(":memory:");
    let n = 0;
    const media = {
      configured: true,
      generateAsset: vi.fn(async () => ({ url: `https://cdn/cover-${++n}.png`, type: "image" as const })),
      generateVideo: vi.fn(async () => ({ url: "https://cdn/clip.mp4", type: "video" as const })),
    };
    // Score the 2nd candidate highest.
    const scoreCover = vi.fn(async (url: string) => (url.includes("cover-2") ? 95 : 10));
    const c = configWithChannel();
    c.trendImitation.coverVariants = 3;
    const deps = makeDeps({ media, scoreCover });

    await runTrendImitation(db, c, "AI coding agents", deps);

    expect(media.generateAsset).toHaveBeenCalledTimes(3);
    expect(scoreCover).toHaveBeenCalledTimes(3);
    const videoCall = (media.generateVideo as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(videoCall.startImage).toBe("https://cdn/cover-2.png");
  });

  it("burns the brief's on-screen beats into the generated clip when captionOverlay is on", async () => {
    const db: DB = createDb(":memory:");
    const captionBurner = vi.fn(async () => "https://cdn/captioned.mp4");
    const c = configWithChannel();
    c.trendImitation.captionOverlay = true;
    const deps = makeDeps({ captionBurner });

    const result = await runTrendImitation(db, c, "AI coding agents", deps);

    expect(captionBurner).toHaveBeenCalledWith("https://cdn/clip.mp4", ["a"], 8);
    expect(result.videoUrl).toBe("https://cdn/captioned.mp4");
  });

  it("falls back to the un-burned hosted clip if caption burning yields an unhostable local path", async () => {
    const db: DB = createDb(":memory:");
    // Simulate a host that couldn't upload the ffmpeg output (passthrough → local path leaks).
    const captionBurner = vi.fn(async () => "/tmp/reuse-xyz.mp4");
    const c = configWithChannel();
    c.trendImitation.captionOverlay = true;
    const deps = makeDeps({ captionBurner });

    const result = await runTrendImitation(db, c, "AI coding agents", deps);

    expect(captionBurner).toHaveBeenCalled();
    expect(result.videoUrl).toBe("https://cdn/clip.mp4"); // reachable, un-burned fallback — never a /tmp path
  });

  it("renders an end-frame keyframe and passes it to the video model when endFrame is on", async () => {
    const db: DB = createDb(":memory:");
    let n = 0;
    const media = {
      configured: true,
      generateAsset: vi.fn(async () => ({ url: `https://cdn/frame-${++n}.png`, type: "image" as const })),
      generateVideo: vi.fn(async () => ({ url: "https://cdn/clip.mp4", type: "video" as const })),
    };
    const c = configWithChannel();
    c.trendImitation.video.endFrame = true;
    const deps = makeDeps({ media });

    await runTrendImitation(db, c, "AI coding agents", deps);

    // one start cover + one end frame
    expect(media.generateAsset).toHaveBeenCalledTimes(2);
    const videoCall = (media.generateVideo as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(videoCall.startImage).toBe("https://cdn/frame-1.png");
    expect(videoCall.endImage).toBe("https://cdn/frame-2.png");
  });

  it("grounds the brief in web-research insight when NotebookLM produced none", async () => {
    const db: DB = createDb(":memory:");
    const build = vi.fn<NonNullable<TrendImitationDeps["briefBuilder"]>["build"]>(async () => brief());
    const webResearchInsight = vi.fn(async () => ({
      text: "Brent fell to $86 — a 14% monthly drop.",
      citations: ["https://oilnews.com/a"],
      prompt: "p",
    }));
    const deps = makeDeps({ briefBuilder: { build }, webResearchInsight });

    await runTrendImitation(db, configWithChannel(), "us oil drops", deps);

    expect(webResearchInsight).toHaveBeenCalled();
    expect(build.mock.calls[0]![0].notebookInsight).toBe("Brent fell to $86 — a 14% monthly drop.");
  });

  it("falls back to a deterministic brief when the LLM brief builder keeps failing", async () => {
    const db: DB = createDb(":memory:");
    const build = vi
      .fn<NonNullable<TrendImitationDeps["briefBuilder"]>["build"]>()
      .mockRejectedValue(new Error("OpenRouter response missing message content"));
    const deps = makeDeps({ briefBuilder: { build } });

    const result = await runTrendImitation(db, configWithChannel(), "AI coding agents", deps);

    // run still completes with a rendered clip rather than dying at the brief step
    expect(result.videoUrl).toBe("https://cdn/clip.mp4");
    const videos = db.select().from(generatedVideos).all();
    expect(videos).toHaveLength(1);
  });

  it("retries a transient brief-builder failure instead of discarding the run", async () => {
    const db: DB = createDb(":memory:");
    const build = vi
      .fn<NonNullable<TrendImitationDeps["briefBuilder"]>["build"]>()
      .mockRejectedValueOnce(new Error("OpenRouter response missing message content"))
      .mockResolvedValueOnce(brief());
    const deps = makeDeps({ briefBuilder: { build } });

    const result = await runTrendImitation(db, configWithChannel(), "AI coding agents", deps);

    expect(build).toHaveBeenCalledTimes(2); // failed once, then succeeded
    expect(result.videoUrl).toBe("https://cdn/clip.mp4");
  });

  it("fans the clip out to every configured platform with per-platform captions", async () => {
    const db: DB = createDb(":memory:");
    const c = configWithChannel();
    c.publishing.channelsByPlatform = { instagram: "ig-1", x: "x-1", reddit: "rd-1" };
    const buffer = fakeBuffer();
    const deps = makeDeps({ buffer });

    await runTrendImitation(db, c, "AI coding agents", deps);

    const createPost = buffer.createPost as unknown as ReturnType<typeof vi.fn>;
    expect(createPost).toHaveBeenCalledTimes(3);
    const byChannel = Object.fromEntries(
      createPost.mock.calls.map(([input]) => [input.channelId, input]),
    );
    expect(byChannel["ig-1"].instagramType).toBe("reel");
    expect(byChannel["x-1"].instagramType).toBeUndefined();
    expect(byChannel["ig-1"].text).toContain("#AIagents");
    expect(byChannel["rd-1"].text).not.toContain("#"); // reddit drops hashtags
    expect(byChannel["x-1"].videoUrl).toBe("https://cdn/clip.mp4");
  });

  it("scores virality with the LLM brief scorer (no Higgsfield) when viralityScorer is llm", async () => {
    const db: DB = createDb(":memory:");
    const c = configWithChannel();
    c.trendImitation.scoreVirality = true;
    c.trendImitation.viralityScorer = "llm";

    const scoreVideo = vi.fn(async () => ({ score: 99, reportUrl: null, raw: "higgsfield" }));
    const scoreBrief = { score: vi.fn(async () => ({ score: 88, reportUrl: null, raw: '{"scorer":"llm"}' })) };
    const deps = makeDeps({ scoreVideo, scoreBrief });

    const result = await runTrendImitation(db, c, "AI coding agents", deps);

    expect(scoreBrief.score).toHaveBeenCalledOnce();
    expect(scoreVideo).not.toHaveBeenCalled(); // the paid Higgsfield path is bypassed
    expect(result.viralityScore).toBe(88);
    expect(result.passed).toBe(true); // 88 >= threshold 70
  });

  it("drafts (never auto-queues) and emits a duet plan when sourceMode is duet", async () => {
    const db: DB = createDb(":memory:");
    const c = configWithChannel(); // saveToDraft false, would normally queue
    c.trendImitation.sourceMode = "duet";
    c.trendImitation.duetSourceUrl = "https://tiktok.com/@x/video/123";

    let publishData: { saveToDraft: boolean; duet: { sourceUrl: string | null } | null } | undefined;
    const deps = makeDeps({
      onStage: (stage, data) => {
        if (stage === "publish") publishData = data as typeof publishData;
      },
    });

    const result = await runTrendImitation(db, c, "AI coding agents", deps);

    expect(publishData?.saveToDraft).toBe(true); // duet is a manual step
    expect(publishData?.duet?.sourceUrl).toBe("https://tiktok.com/@x/video/123");
    expect(result.status).toBe("draft");
  });

  it("reuses a license-cleared stock clip instead of generating when sourceMode is stock", async () => {
    const db: DB = createDb(":memory:");
    const c = configWithChannel();
    c.trendImitation.sourceMode = "stock";

    const media = fakeHiggsfield();
    const stockSource = vi.fn(async () => ({
      videoUrl: "https://cdn/stock-clip.mp4",
      coverUrl: "https://cdn/stock-cover.jpg",
      clipId: "pex-1",
      provider: "pexels",
      licence: "Pexels License",
    }));
    const deps = makeDeps({ media, stockSource });

    const result = await runTrendImitation(db, c, "AI coding agents", deps);

    expect(stockSource).toHaveBeenCalledOnce();
    expect(media.generateAsset).not.toHaveBeenCalled();
    expect(media.generateVideo).not.toHaveBeenCalled();
    expect(result.videoUrl).toBe("https://cdn/stock-clip.mp4");

    const videos = db.select().from(generatedVideos).all();
    expect(videos[0]!.videoUrl).toBe("https://cdn/stock-clip.mp4");
    expect(videos[0]!.coverImageUrl).toBe("https://cdn/stock-cover.jpg");
  });

  it("falls back to generation when the stock source returns nothing", async () => {
    const db: DB = createDb(":memory:");
    const c = configWithChannel();
    c.trendImitation.sourceMode = "stock";

    const media = fakeHiggsfield();
    const deps = makeDeps({ media, stockSource: vi.fn(async () => null) });

    const result = await runTrendImitation(db, c, "AI coding agents", deps);

    expect(media.generateVideo).toHaveBeenCalledOnce();
    expect(result.videoUrl).toBe("https://cdn/clip.mp4");
  });

  it("generates brief variants in parallel and keeps the best-scoring one", async () => {
    const db: DB = createDb(":memory:");
    const c = configWithChannel();
    c.trendImitation.briefVariants = 3;

    let n = 0;
    const hooks = ["weak hook", "BEST hook", "mid hook"];
    const build = vi.fn(async () => ({ ...brief(), hook: hooks[n++]! }));
    const judge = {
      judge: vi.fn(async (input: { brief: { hook: string } }) => ({
        score: input.brief.hook === "BEST hook" ? 95 : 50,
        angle: "a",
        rationale: "r",
        risks: "",
      })),
    };
    const variantEvents: unknown[] = [];
    const deps = makeDeps({
      briefBuilder: { build },
      judge,
      onStage: (stage, data) => {
        if (stage === "brief_variants") variantEvents.push(data);
      },
    });

    await runTrendImitation(db, c, "AI coding agents", deps);

    expect(build).toHaveBeenCalledTimes(3);
    expect(judge.judge).toHaveBeenCalledTimes(3);
    const videos = db.select().from(generatedVideos).all();
    expect((videos[0]!.brief as { hook: string }).hook).toBe("BEST hook");
    expect(variantEvents).toHaveLength(1);
  });

  it("passes the cover frame as start-image and queues a reel when the gate passes", async () => {
    const db = createDb(":memory:");
    const deps = makeDeps();
    await runTrendImitation(db, configWithChannel(), "AI coding agents", deps);

    expect(deps.media.generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({ startImage: "https://cdn/cover.png", aspectRatio: "9:16" }),
    );
    expect(deps.buffer.createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "ig-1",
        videoUrl: "https://cdn/clip.mp4",
        instagramType: "reel",
        saveToDraft: false,
      }),
    );
    const row = db.select().from(generatedVideos).all()[0]!;
    expect(row.status).toBe("queued");
    expect(row.bufferPostId).toBe("buf-1");
  });

  it("feeds an embeddable royalty-free track to --audio", async () => {
    const db = createDb(":memory:");
    const deps = makeDeps({
      findSounds: vi.fn(async () => [sound()]),
      mapTrack: vi.fn(() => safeTrack({ trackUrl: "https://cdn/cc0.mp3", embeddable: true })),
    });
    await runTrendImitation(db, configWithChannel(), "AI coding agents", deps);
    expect(deps.media.generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({ audio: "https://cdn/cc0.mp3" }),
    );
  });

  it("never passes a commercial (non-embeddable) track to --audio", async () => {
    const db = createDb(":memory:");
    const deps = makeDeps();
    await runTrendImitation(db, configWithChannel(), "AI coding agents", deps);
    const call = (deps.media.generateVideo as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.audio).toBeUndefined();
  });

  it("forces a draft and does not queue when the virality gate fails", async () => {
    const db = createDb(":memory:");
    const deps = makeDeps({
      scoreVideo: vi.fn(async () => ({ score: 30, reportUrl: null, raw: "Overall: 30" })),
    });
    const result = await runTrendImitation(db, configWithChannel(), "AI coding agents", deps);

    expect(result.passed).toBe(false);
    expect(deps.buffer.createPost).toHaveBeenCalledWith(
      expect.objectContaining({ saveToDraft: true }),
    );
    expect(db.select().from(generatedVideos).all()[0]!.status).toBe("draft");
  });

  it("skips virality scoring (no scoreVideo call) and drafts when scoreVirality is off", async () => {
    const db = createDb(":memory:");
    const deps = makeDeps();
    const cfg = configWithChannel();
    cfg.trendImitation.scoreVirality = false;

    const result = await runTrendImitation(db, cfg, "AI coding agents", deps);

    expect(deps.scoreVideo).not.toHaveBeenCalled();
    expect(result.viralityScore).toBeNull();
    expect(result.passed).toBe(false);
    expect(db.select().from(generatedVideos).all()[0]!.status).toBe("draft");
  });

  it("re-hosts the cover and video to durable URLs before publishing", async () => {
    const db = createDb(":memory:");
    const deps = makeDeps({
      mediaHost: {
        persist: vi.fn(async (url: string) =>
          url.endsWith(".mp4") ? "https://durable/clip.mp4" : "https://durable/cover.png",
        ),
      },
    });
    const result = await runTrendImitation(db, configWithChannel(), "AI coding agents", deps);

    expect(result.videoUrl).toBe("https://durable/clip.mp4");
    expect(deps.buffer.createPost).toHaveBeenCalledWith(
      expect.objectContaining({ videoUrl: "https://durable/clip.mp4", thumbnailUrl: "https://durable/cover.png" }),
    );
    expect(db.select().from(generatedVideos).all()[0]!.videoUrl).toBe("https://durable/clip.mp4");
  });

  it("emits each pipeline stage in order via onStage", async () => {
    const db = createDb(":memory:");
    const stages: string[] = [];
    const deps = makeDeps({ onStage: (stage) => stages.push(stage) });
    await runTrendImitation(db, configWithChannel(), "AI coding agents", deps);
    expect(stages).toEqual([
      "research",
      "exemplars",
      "music",
      "brief",
      "decision",
      "cover",
      "video",
      "virality",
      "publish",
    ]);
  });

  it("emits the resolved cover/video model on their stage events when the provider has a model", async () => {
    const db = createDb(":memory:");
    const cfg = configWithChannel();
    cfg.trendImitation = applyMediaOverride(cfg.trendImitation, {
      coverModel: "black-forest-labs/flux-1.1-pro",
      videoModel: "kwaivgi/kling-v1.6-pro",
    });
    const events: { stage: string; data: unknown }[] = [];
    const deps = makeDeps({ onStage: (stage, data) => events.push({ stage, data }) });

    await runTrendImitation(db, cfg, "AI coding agents", deps);

    const cover = events.find((e) => e.stage === "cover")?.data as { model: string | null };
    const video = events.find((e) => e.stage === "video")?.data as { model: string | null };
    expect(cover.model).toBe("black-forest-labs/flux-1.1-pro");
    expect(video.model).toBe("kwaivgi/kling-v1.6-pro");
  });

  it("emits a null model on cover/video stages for higgsfield (no per-model config)", async () => {
    const db = createDb(":memory:");
    const events: { stage: string; data: unknown }[] = [];
    const deps = makeDeps({ onStage: (stage, data) => events.push({ stage, data }) });

    await runTrendImitation(db, configWithChannel(), "AI coding agents", deps);

    const cover = events.find((e) => e.stage === "cover")?.data as { model: string | null };
    const video = events.find((e) => e.stage === "video")?.data as { model: string | null };
    expect(cover.model).toBeNull();
    expect(video.model).toBeNull();
  });

  it("gates: a low idea-judge score skips rendering and returns rejected", async () => {
    const db = createDb(":memory:");
    const deps = makeDeps({
      judge: { judge: vi.fn(async () => ({ score: 20, angle: "weak", rationale: "derivative", risks: "" })) },
    });
    const result = await runTrendImitation(db, configWithChannel(), "AI coding agents", deps);

    expect(result.status).toBe("rejected");
    expect(result.ideaScore).toBe(20);
    expect(deps.media.generateAsset).not.toHaveBeenCalled();
    expect(deps.media.generateVideo).not.toHaveBeenCalled();
    expect(deps.buffer.createPost).not.toHaveBeenCalled();
    // sounds were still catalogued before the gate
    expect(db.select().from(musicTracks).all().length).toBeGreaterThan(0);
    // nothing rendered ⇒ no generated_videos row
    expect(db.select().from(generatedVideos).all()).toHaveLength(0);
  });

  it("keeps the rendered video as a draft when virality scoring fails", async () => {
    const db = createDb(":memory:");
    const deps = makeDeps({
      scoreVideo: vi.fn(async () => {
        throw new Error("plan limit");
      }),
    });
    const result = await runTrendImitation(db, configWithChannel(), "AI coding agents", deps);

    expect(result.videoUrl).toBe("https://cdn/clip.mp4");
    expect(result.viralityScore).toBeNull();
    expect(result.passed).toBe(false);
    expect(db.select().from(generatedVideos).all()[0]!.status).toBe("draft");
  });

  it("persists the video but skips publishing when no channel is configured", async () => {
    const db = createDb(":memory:");
    const deps = makeDeps();
    const cfg = parseConfig({}); // no instagram channel
    const result = await runTrendImitation(db, cfg, "AI coding agents", deps);

    expect(deps.buffer.createPost).not.toHaveBeenCalled();
    expect(result.bufferPostId).toBeNull();
    expect(db.select().from(generatedVideos).all()).toHaveLength(1);
  });
});

describe("runSingleTrendRun", () => {
  function seedRun(db: DB, id = "run-1"): void {
    db.insert(trendRuns)
      .values({
        id,
        topic: "AI coding agents",
        mode: "live",
        assetStyle: "standard",
        status: "pending",
        stages: [],
        createdAt: "2026-06-15T00:00:00.000Z",
        updatedAt: "2026-06-15T00:00:00.000Z",
      })
      .run();
  }

  it("streams stage progress into the trend_runs row and records ok + video id", async () => {
    const db: DB = createDb(":memory:");
    seedRun(db);
    const deps = makeDeps();

    await runSingleTrendRun(db, configWithChannel(), {}, { runId: "run-1", topic: "AI coding agents" }, deps);

    const row = db.select().from(trendRuns).where(eq(trendRuns.id, "run-1")).get();
    expect(row?.status).toBe("ok");
    expect(row?.generatedVideoId).toBeTruthy();
    const stageNames = (row?.stages ?? []).map((s) => s.stage);
    expect(stageNames).toContain("brief");
    expect(stageNames).toContain("video");
    expect(db.select().from(generatedVideos).all()).toHaveLength(1);
  });

  it("records status=failed (no throw) when the pipeline errors, so the job never retries", async () => {
    const db: DB = createDb(":memory:");
    seedRun(db, "run-2");
    const deps = makeDeps({ research: vi.fn(async () => { throw new Error("research blew up"); }) });

    await runSingleTrendRun(db, configWithChannel(), {}, { runId: "run-2", topic: "AI coding agents" }, deps);

    const row = db.select().from(trendRuns).where(eq(trendRuns.id, "run-2")).get();
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("research blew up");
  });

  it("parks at awaiting_review with a render context when reviewEnabled, instead of rendering", async () => {
    const db: DB = createDb(":memory:");
    seedRun(db, "run-3");
    const deps = makeDeps();

    await runSingleTrendRun(
      db,
      configWithChannel(),
      {},
      { runId: "run-3", topic: "AI coding agents", reviewEnabled: true },
      deps,
    );

    const row = db.select().from(trendRuns).where(eq(trendRuns.id, "run-3")).get();
    expect(row?.status).toBe("awaiting_review");
    expect(row?.generatedVideoId).toBeFalsy();
    expect(db.select().from(generatedVideos).all()).toHaveLength(0);

    const ctx = row?.renderContext as unknown as RenderContext;
    expect(ctx.coverPrompt).toBeTruthy();
    expect(ctx.videoPrompt).toBeTruthy();
    expect(ctx.topic).toBe("AI coding agents");

    expect(deps.media.generateAsset).not.toHaveBeenCalled();
    expect(deps.media.generateVideo).not.toHaveBeenCalled();
  });

  it("honors coverModel/videoModel overrides: switches provider to replicate and records the choice in the render context", async () => {
    const db: DB = createDb(":memory:");
    seedRun(db, "run-3b");
    const deps = makeDeps();

    await runSingleTrendRun(
      db,
      configWithChannel(),
      {},
      {
        runId: "run-3b",
        topic: "AI coding agents",
        reviewEnabled: true,
        coverModel: "black-forest-labs/flux-1.1-pro",
        videoModel: "kwaivgi/kling-v1.6-pro",
      },
      deps,
    );

    const row = db.select().from(trendRuns).where(eq(trendRuns.id, "run-3b")).get();
    const ctx = row?.renderContext as unknown as RenderContext;
    expect(ctx.mediaProvider).toBe("replicate");
    expect(ctx.coverModel).toBe("black-forest-labs/flux-1.1-pro");
    expect(ctx.videoModel).toBe("kwaivgi/kling-v1.6-pro");
  });

  it("does not park (renders immediately) when reviewEnabled is false/omitted, even with scoreVirality on", async () => {
    const db: DB = createDb(":memory:");
    seedRun(db, "run-4");
    const deps = makeDeps();

    await runSingleTrendRun(db, configWithChannel(), {}, { runId: "run-4", topic: "AI coding agents" }, deps);

    const row = db.select().from(trendRuns).where(eq(trendRuns.id, "run-4")).get();
    expect(row?.status).toBe("ok");
    expect(row?.renderContext).toBeFalsy();
  });
});

describe("runTrendRenderResume", () => {
  function seedAwaitingReview(db: DB, ctx: RenderContext, id = "run-resume-1"): void {
    db.insert(trendRuns)
      .values({
        id,
        topic: ctx.topic,
        mode: "live",
        assetStyle: ctx.assetStyle,
        status: "awaiting_review",
        stages: [],
        renderContext: ctx as unknown as Record<string, unknown>,
        createdAt: "2026-06-15T00:00:00.000Z",
        updatedAt: "2026-06-15T00:00:00.000Z",
      })
      .run();
  }

  it("renders from the persisted context, records ok + video id, and clears the context", async () => {
    const db: DB = createDb(":memory:");
    const ctx: RenderContext = {
      topic: "AI coding agents",
      brief: brief(),
      exemplars: [exemplar()],
      coverPrompt: "edited cover prompt",
      videoPrompt: "edited video prompt",
      soundsCatalogued: 2,
      assetStyle: "standard",
      ideaScore: 80,
      mediaProvider: "higgsfield",
    };
    seedAwaitingReview(db, ctx);
    const deps = makeDeps();

    await runTrendRenderResume(db, configWithChannel(), {}, "run-resume-1", deps);

    const row = db.select().from(trendRuns).where(eq(trendRuns.id, "run-resume-1")).get();
    expect(row?.status).toBe("ok");
    expect(row?.generatedVideoId).toBeTruthy();
    expect(row?.renderContext).toBeFalsy();
    expect(db.select().from(generatedVideos).all()).toHaveLength(1);

    expect(deps.media.generateAsset).toHaveBeenCalled();
    const videoCall = (deps.media.generateVideo as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(videoCall.prompt ?? videoCall).toBeTruthy();
  });

  it("records status=failed when there is no render context to resume from", async () => {
    const db: DB = createDb(":memory:");
    db.insert(trendRuns)
      .values({
        id: "run-resume-2",
        topic: "AI coding agents",
        mode: "live",
        assetStyle: "standard",
        status: "awaiting_review",
        stages: [],
        renderContext: null,
        createdAt: "2026-06-15T00:00:00.000Z",
        updatedAt: "2026-06-15T00:00:00.000Z",
      })
      .run();

    await runTrendRenderResume(db, configWithChannel(), {}, "run-resume-2", makeDeps());

    const row = db.select().from(trendRuns).where(eq(trendRuns.id, "run-resume-2")).get();
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("no render context");
  });
});

describe("buildTiktokSoundRunner", () => {
  it("returns undefined when tiktok_sounds is disabled (the default)", () => {
    expect(buildTiktokSoundRunner(parseConfig({}), {})).toBeUndefined();
  });

  it("fetches the chart and maps signals to evidence-only SoundTrends when enabled", async () => {
    const cfg = parseConfig({ sources: { tiktok_sounds: { enabled: true } } });
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              sound_list: [
                {
                  song_id: 7,
                  title: "Banger",
                  author: "Artist",
                  link: "https://tt/music/7",
                  play_count: 12345,
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    try {
      const runner = buildTiktokSoundRunner(cfg, {});
      expect(runner).toBeDefined();
      const sounds = await runner!("ai agents");
      expect(sounds).toHaveLength(1);
      expect(sounds[0]).toMatchObject({
        topic: "ai agents",
        title: "Banger — Artist",
        url: "https://tt/music/7",
        whereTrending: "tiktok_sounds",
        engagement: 12345,
      });
    } finally {
      globalThis.fetch = original;
    }
  });
});
