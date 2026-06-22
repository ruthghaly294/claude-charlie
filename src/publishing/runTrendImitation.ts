import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { generatedVideos, musicTracks, trendRuns, type GeneratedVideo } from "@/db/schema";
import type { DecodeConfig, TrendImitationConfig } from "@/discovery/config";
import { runLast30Days } from "@/research/last30days";
import { rankReport, type RankedReport } from "@/research/rank";
import { cachedResearchReport } from "@/research/researchCache";
import { getEmbedder, semanticScores } from "@/lib/embeddings";
import { getExemplarExtractor, type ExemplarExtractor } from "@/research/exemplars";
import { enrichThumbnails } from "@/research/thumbnails";
import { findTrendingSounds, makeSoundTrend, type SoundTrend } from "@/research/musicTrends";
import { mapToSafeTrack, type SafeTrack } from "@/research/royaltyFreeMap";
import { tiktokSoundsConnector } from "@/discovery/connectors";
import type { ConnectorContext } from "@/discovery/types";
import { getBriefBuilder, deterministicBriefBuilder, type BriefBuilder, type CreativeBrief } from "./creativeBrief";
import { getIdeaJudge, type IdeaJudge, type IdeaJudgment } from "./ideaJudge";
import type { Exemplar } from "@/research/exemplars";
import type { MediaGenerator } from "./higgsfieldClient";
import { getMediaGenerator, applyMediaOverride, describeMediaSelection, type MediaOverride } from "./mediaProvider";
import { getMediaHost, type MediaHost } from "./mediaHost";
import { scoreVideo as scoreVideoImpl, passesViralityGate, type ViralityReport } from "./viralityScore";
import { getBriefViralityScorer, type BriefViralityScorer } from "./viralityLlm";
import { getCoverScorer } from "./coverScorer";
import { createBufferClient, type BufferClient } from "./bufferClient";
import type { PublishPlatform } from "./postGenerator";
import { mapWithConcurrency } from "@/lib/concurrency";
import { resolvePrompt, loadPromptOverrides } from "./prompts";
import { resolveVariantTemplates } from "./promptVariants";
import { runNotebookInsight, buildNotebookInsightDeps, type NotebookInsightTrace } from "./notebookInsight";
import { getWebResearchInsight, type WebResearchInsight } from "./webResearchInsight";
import { getStockProvider } from "./videoReuse/stockProvider";
import { composeReusedClip, type ReuseClipDeps } from "./videoReuse/reuseClip";
import { resolveLocalMedia } from "./mediaDownload";
import { tmpdir } from "node:os";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * A license-cleared stock clip resolved for a brief: a durable video URL (and an
 * optional cover frame), plus provenance the UI can credit. Implementations gate
 * on licence so only rights-cleared footage is ever rendered/hosted — the video
 * analogue of the royalty-free-audio invariant.
 */
export type StockSourceResult = {
  videoUrl: string;
  coverUrl: string | null;
  clipId: string;
  provider: string;
  licence: string;
};
export type StockSource = (input: {
  query: string;
  brief: CreativeBrief;
}) => Promise<StockSourceResult | null>;

/** Everything the orchestrator depends on, injected for testability. */
export type TrendImitationDeps = {
  /** topic → ranked research report (last30days + rank). */
  research: (topic: string) => Promise<RankedReport>;
  extractor: ExemplarExtractor;
  /** optional NotebookLM insight layer: distills a content-ready insight to ground the brief. */
  notebookInsight?: (topic: string, report: RankedReport) => Promise<NotebookInsightTrace | null>;
  /** optional content-scraping insight: reads the page bodies behind top picks and distills a grounded insight (NotebookLM-free). */
  webResearchInsight?: (topic: string, report: RankedReport) => Promise<WebResearchInsight | null>;
  findSounds: (topic: string) => Promise<SoundTrend[]>;
  mapTrack: (trend: SoundTrend) => SafeTrack;
  briefBuilder: BriefBuilder;
  /** pre-generation decision gate: scores the planned brief before any render spend. */
  judge: IdeaJudge;
  /** cover/video generator — Higgsfield, Replicate, or MuAPI per config provider. */
  media: MediaGenerator;
  /** license-cleared stock-clip source for sourceMode "stock"; absent ⇒ falls back to generate. */
  stockSource?: StockSource;
  /** re-hosts ephemeral generated media to durable URLs before scheduling. */
  mediaHost: MediaHost;
  /** optional: burn the brief's on-screen text beats into a (generated) clip and return a hosted URL. */
  captionBurner?: (videoUrl: string, beats: string[], durationSec: number) => Promise<string>;
  scoreVideo: (videoRef: string) => Promise<ViralityReport>;
  /** optional LLM brief-virality scorer (owl-alpha) used when viralityScorer === "llm". */
  scoreBrief?: BriefViralityScorer;
  /** optional vision scorer for best-of-N cover selection (rates a cover frame 0-100). */
  scoreCover?: (imageUrl: string, brief: CreativeBrief) => Promise<number>;
  buffer: BufferClient;
  now: () => string;
  id: () => string;
  /** optional observability hook fired after each pipeline stage (for tracing/UI). */
  onStage?: (stage: TrendStage, data: unknown) => void;
  /** DB-backed prompt template overrides (see src/publishing/prompts.ts); falls back to built-in defaults. */
  promptOverrides?: Record<string, string>;
};

/** Named pipeline stages, in order, emitted to `deps.onStage`. */
export type TrendStage =
  | "research"
  | "exemplars"
  | "insight"
  | "music"
  | "brief_variants"
  | "brief"
  | "decision"
  | "cover"
  | "video"
  | "virality"
  | "publish";

export type TrendImitationResult = {
  topic: string;
  videoId: string;
  videoUrl: string;
  viralityScore: number | null;
  /** pre-generation idea-judge score (0–100); null if judging was skipped. */
  ideaScore: number | null;
  passed: boolean;
  status: GeneratedVideo["status"];
  bufferPostId: string | null;
  soundsCatalogued: number;
};

/**
 * Everything the render phase needs, captured once the brief has cleared the
 * idea-judge gate. Serializable (stored verbatim in `trend_runs.render_context`)
 * so a paused run can be resumed — optionally with operator-edited prompts —
 * without re-running research/brief/judge.
 */
export type RenderContext = {
  topic: string;
  brief: CreativeBrief;
  exemplars: Exemplar[];
  coverPrompt: string;
  videoPrompt: string;
  audio?: string;
  soundsCatalogued: number;
  assetStyle: "standard" | "infographic";
  /** video source lane; absent (legacy stored contexts) ⇒ "generate". */
  sourceMode?: "generate" | "stock" | "duet";
  ideaScore: number;
  /** the provider/models actually resolved for this run (see `describeMediaSelection`), carried across the review pause so resume reconstructs an identical selection. */
  mediaProvider: TrendImitationConfig["provider"];
  coverModel?: string;
  videoModel?: string;
};

export type ResearchPhaseResult =
  | { cleared: false; topic: string; judgment: IdeaJudgment; soundsCatalogued: number }
  | { cleared: true; ctx: RenderContext };

/** Wrap the brief's coverImagePrompt with the configured asset-style scaffold. */
function resolveCoverPrompt(
  assetStyle: "standard" | "infographic",
  brief: CreativeBrief,
  overrides?: Record<string, string>,
): string {
  if (assetStyle === "infographic") {
    return resolvePrompt(
      "cover.scaffold.infographic",
      { topic: brief.topic, coverImagePrompt: brief.coverImagePrompt },
      overrides,
    );
  }
  return resolvePrompt("cover.scaffold.standard", { coverImagePrompt: brief.coverImagePrompt }, overrides);
}

/**
 * Build the END-frame (last keyframe) cover prompt: the same subject/style as the
 * opening cover, but showing the clip's final beat (the brief's last shot), so the
 * video model has a target to animate toward instead of free-running off frame 1.
 */
function resolveEndCoverPrompt(
  assetStyle: "standard" | "infographic",
  brief: CreativeBrief,
  overrides?: Record<string, string>,
): string {
  const finalBeat = brief.shotList[brief.shotList.length - 1]?.description ?? brief.hook;
  const endImagePrompt = `${brief.coverImagePrompt} — this is the FINAL frame of the clip showing the payoff/resolution: ${finalBeat}. Keep the same subject, style, lighting, and color palette as the opening frame.`;
  return resolveCoverPrompt(assetStyle, { ...brief, coverImagePrompt: endImagePrompt }, overrides);
}

/** Wrap the brief's videoPrompt with cinematographic direction before it reaches the video model. */
function resolveVideoPrompt(brief: CreativeBrief, overrides?: Record<string, string>): string {
  return resolvePrompt(
    "video.scaffold",
    { topic: brief.topic, videoPrompt: brief.videoPrompt, soundMood: brief.soundMood },
    overrides,
  );
}

/** Persist one trending-sound evidence row + its safe substitute into the library. */
function insertMusicTrack(
  db: DB,
  topic: string,
  trend: SoundTrend,
  safe: SafeTrack,
  now: string,
  id: string,
): void {
  db.insert(musicTracks)
    .values({
      id,
      topic,
      trendTitle: trend.title,
      trendUrl: trend.url,
      whereTrending: trend.whereTrending,
      engagement: trend.engagement,
      mood: trend.mood,
      energy: trend.energy,
      nativeSoundId: trend.soundId ?? null,
      provider: safe.provider,
      safeSearchQuery: safe.searchQuery,
      safeTrackUrl: safe.trackUrl,
      licence: safe.licence,
      embeddable: safe.embeddable,
      createdAt: now,
    })
    .run();
}

function composePostText(caption: string, hashtags: string[]): string {
  const tags = hashtags
    .map((h) => `#${h.trim().replace(/^#+/, "")}`)
    .filter((t) => t.length > 1);
  return tags.length ? `${caption.trim()}\n\n${tags.join(" ")}` : caption.trim();
}

/** Visual search query for the stock lane — the topic is the most search-friendly cue. */
function stockQueryFromBrief(brief: CreativeBrief): string {
  return brief.topic;
}

export type DuetPlan = {
  sourceUrl: string | null;
  attribution: string;
  instruction: string;
};

/**
 * Duet/stitch is a platform-native, in-app action (you can't upload a duet via
 * Buffer), so the pipeline produces the creator's commentary clip and a manual
 * instruction + attribution. The reused clip is referenced, never re-hosted.
 */
export function buildDuetPlan(brief: CreativeBrief, sourceUrl?: string): DuetPlan {
  return {
    sourceUrl: sourceUrl ?? null,
    attribution: sourceUrl ? `Duet/stitch with original creator — credit ${sourceUrl}` : "Add attribution to the original creator",
    instruction: sourceUrl
      ? `In the TikTok/IG app, start a Duet or Stitch with ${sourceUrl}, then add this commentary clip as your side and post natively.`
      : "Set a duet_source_url to reference the clip you're reacting to; post the commentary as a native Duet/Stitch.",
  };
}

/** Per-platform hard caption limits (chars); platforms not listed are uncapped. */
const PLATFORM_MAX_LEN: Partial<Record<PublishPlatform, number>> = { x: 280 };

/**
 * Format the brief's caption for one platform: Reddit drops hashtags (norm is a
 * title + body, not tags), X truncates to 280, others get caption + hashtags.
 */
function formatCaptionForPlatform(platform: PublishPlatform, brief: CreativeBrief): string {
  let text =
    platform === "reddit"
      ? brief.caption.trim()
      : composePostText(brief.caption, brief.hashtags);
  const max = PLATFORM_MAX_LEN[platform];
  if (max && text.length > max) text = `${text.slice(0, max - 1).trimEnd()}…`;
  return text;
}

/**
 * Default stock source: license-cleared portrait clips from Pexels (already
 * 9:16/Reels-ready), persisted through the media host for durable scheduling.
 * Returns undefined when no provider is configured (no PEXELS_API_KEY) so the
 * orchestrator falls back to the generate lane.
 */
/** Default file-system + media-host wiring for the reuse pipeline (live runs). */
function defaultReuseDeps(mediaHost: MediaHost): ReuseClipDeps {
  return {
    download: (url) => resolveLocalMedia(url),
    host: (path) => mediaHost.persist(path),
    writeSubtitle: async (srt) => {
      const path = join(tmpdir(), `reuse-${randomUUID()}.srt`);
      await writeFile(path, srt, "utf8");
      return path;
    },
    tmpPath: (ext) => join(tmpdir(), `reuse-${randomUUID()}${ext}`),
  };
}

function buildStockSource(
  env: Record<string, string | undefined>,
  mediaHost: MediaHost,
  captionOverlay: boolean,
): StockSource | undefined {
  const provider = getStockProvider(env);
  if (!provider.configured) return undefined;
  return async ({ query, brief }) => {
    const clips = await provider.search(query, {
      orientation: "portrait",
      perPage: 15,
      minDurationSec: 4,
    });
    const clip = clips.find((c) => c.embeddable);
    if (!clip) return null;
    // Portrait Pexels clips are already 9:16, so no reframe; burn the brief's
    // on-screen text beats in when caption overlay is enabled, else host as-is.
    const videoUrl = captionOverlay
      ? await composeReusedClip(clip.url, defaultReuseDeps(mediaHost), {
          reframe: "none",
          captions: "beats",
          beats: brief.onScreenText,
          durationSec: brief.durationSec,
        })
      : await mediaHost.persist(clip.url);
    return {
      videoUrl,
      coverUrl: null,
      clipId: clip.id,
      provider: clip.provider,
      licence: clip.licence,
    };
  };
}

/** Run `fn`, retrying transient failures up to `attempts` times before rethrowing. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Phase 1: research → exemplars → trending-sound catalog → creative brief →
 * idea-judge decision gate. Stops here — no render spend yet. When the idea
 * clears the gate, returns a serializable `RenderContext` ready for phase 2
 * (either immediately, or after an operator review/edit pause).
 */
export async function runResearchPhase(
  db: DB,
  config: DecodeConfig,
  topic: string,
  deps: TrendImitationDeps,
): Promise<ResearchPhaseResult> {
  const { trendImitation: ti } = config;
  const emit = deps.onStage ?? (() => {});

  const report = await deps.research(topic);
  emit("research", report.topPicks);
  const exemplars = await deps.extractor.extract(report);
  emit("exemplars", { items: exemplars, prompt: deps.extractor.describePrompt?.(report) ?? null });

  // Outsourced-research layer (opt-in): distill a NotebookLM insight to ground the
  // brief's "innovate" step. Returns null when disabled/unconfigured ⇒ behave as before.
  let notebookInsight: string | undefined;
  if (deps.notebookInsight) {
    const ni = await deps.notebookInsight(topic, report);
    if (ni) {
      notebookInsight = ni.text;
      // Emit the full round-trip so the UI can show what went into NotebookLM and what came back.
      emit("insight", {
        text: ni.text,
        citations: ni.citations,
        notebookId: ni.notebookId,
        mode: ni.mode,
        prompt: ni.prompt,
        addedSources: ni.addedSources,
      });
    }
  }

  // Content-scraping insight (NotebookLM-free): reads the page bodies behind the
  // top picks and distills a grounded insight. Runs alongside NotebookLM, filling
  // the grounding slot when NotebookLM produced nothing. Best-effort — never aborts.
  if (!notebookInsight && deps.webResearchInsight) {
    const wi = await deps.webResearchInsight(
      topic,
      report,
    ).catch(() => null);
    if (wi) {
      notebookInsight = wi.text;
      emit("insight", {
        text: wi.text,
        citations: wi.citations,
        notebookId: null,
        mode: "web-research",
        prompt: wi.prompt,
        addedSources: wi.citations,
      });
    }
  }

  // Music evidence layer: catalog trending sounds, mapped to safe substitutes.
  const sounds = await deps.findSounds(topic);
  const safeTracks = sounds.map((s) => ({ trend: s, safe: deps.mapTrack(s) }));
  for (const { trend, safe } of safeTracks) {
    insertMusicTrack(db, topic, trend, safe, deps.now(), deps.id());
  }
  emit("music", safeTracks);
  const chosen = safeTracks[0];

  // The LLM brief builder occasionally returns an empty body ("missing message
  // content"); retry before discarding the (already-paid) research/recipes work.
  // When briefVariants > 1 we generate several briefs IN PARALLEL (the key pool
  // gives us the concurrency), idea-judge each, and keep the best-scoring one —
  // turning the single-shot brief into a best-of-N without extra wall-clock time.
  const briefInput = {
    topic,
    exemplars,
    soundMood: chosen?.safe.mood,
    notebookInsight,
    manualResearch: ti.manualResearch,
  };
  const variantCount = Math.max(1, ti.briefVariants);
  let candidates: { brief: CreativeBrief; judgment: IdeaJudgment }[];
  try {
    candidates = await Promise.all(
      Array.from({ length: variantCount }, () =>
        withRetry(async () => {
          const brief = await deps.briefBuilder.build(briefInput);
          const judgment = await deps.judge.judge({ topic, exemplars, brief });
          return { brief, judgment };
        }),
      ),
    );
  } catch (err) {
    // The LLM brief builder is down/flaky (e.g. a model returning empty content
    // every retry). Rather than discard the whole run, degrade to a deterministic
    // templated brief so the pipeline still produces something.
    console.warn(
      `[trend] LLM brief failed, using deterministic fallback: ${err instanceof Error ? err.message : String(err)}`,
    );
    const brief = await deterministicBriefBuilder.build(briefInput);
    const judgment = await Promise.resolve(deps.judge.judge({ topic, exemplars, brief })).catch(
      (): IdeaJudgment => ({
        score: ti.ideaThreshold,
        angle: brief.hook,
        rationale: "Idea judge unavailable; proceeding with deterministic brief.",
        risks: "Brief generated by deterministic fallback (LLM unavailable).",
      }),
    );
    candidates = [{ brief, judgment }];
  }
  // Highest idea-judge score wins; ties keep the earliest (stable, deterministic).
  const best = candidates.reduce((a, b) => (b.judgment.score > a.judgment.score ? b : a));
  const brief = best.brief;
  const judgment: IdeaJudgment = best.judgment;
  if (variantCount > 1) {
    emit(
      "brief_variants",
      candidates.map((c, i) => ({
        index: i,
        score: c.judgment.score,
        hook: c.brief.hook,
        chosen: c === best,
      })),
    );
  }
  emit("brief", { brief, prompt: deps.briefBuilder.describePrompt?.(briefInput) ?? null });

  // Decision gate: judge the plan BEFORE spending on rendering. Below threshold ⇒
  // park the idea (no render, no cost) and return early.
  const judgeInput = { topic, exemplars, brief };
  const cleared = judgment.score >= ti.ideaThreshold;
  emit("decision", {
    ...judgment,
    threshold: ti.ideaThreshold,
    cleared,
    prompt: deps.judge.describePrompt?.(judgeInput) ?? null,
  });
  if (!cleared) {
    return { cleared: false, topic, judgment, soundsCatalogued: safeTracks.length };
  }

  const coverPrompt = resolveCoverPrompt(ti.assetStyle, brief, deps.promptOverrides);
  const videoPrompt = resolveVideoPrompt(brief, deps.promptOverrides);
  // Only royalty-free/CC/owned audio is ever embedded; commercial trends stay as
  // evidence in music_tracks (apply the platform-native sound in-app instead).
  const audio = chosen?.safe.embeddable ? chosen.safe.trackUrl ?? undefined : undefined;
  const mediaSelection = describeMediaSelection(ti);

  return {
    cleared: true,
    ctx: {
      topic,
      brief,
      exemplars,
      coverPrompt,
      videoPrompt,
      audio,
      soundsCatalogued: safeTracks.length,
      assetStyle: ti.assetStyle,
      sourceMode: ti.sourceMode,
      ideaScore: judgment.score,
      mediaProvider: mediaSelection.provider,
      coverModel: mediaSelection.coverModel,
      videoModel: mediaSelection.videoModel,
    },
  };
}

/**
 * Phase 2: cover image → seedance video (with a royalty-free soundtrack only) →
 * virality gate → persist → publish/draft via Buffer. Below-threshold
 * (or unknown-score) clips are always drafted for review. Takes a `RenderContext`
 * produced by `runResearchPhase` — possibly operator-edited during a review pause.
 */
export async function runRenderPhase(
  db: DB,
  config: DecodeConfig,
  deps: TrendImitationDeps,
  ctx: RenderContext,
): Promise<TrendImitationResult> {
  const { trendImitation: ti } = config;
  const emit = deps.onStage ?? (() => {});
  const { topic, brief, exemplars, coverPrompt, videoPrompt, audio, soundsCatalogued, ideaScore, coverModel, videoModel } = ctx;

  let coverUrl: string;
  let videoUrl: string;

  // Stock lane: reuse a license-cleared clip instead of synthesizing from scratch.
  // Best-effort — if the source is unconfigured, finds nothing, or errors, we fall
  // through to the generate path so a run never dies just because stock was empty.
  const stockResult =
    (ctx.sourceMode ?? "generate") === "stock" && deps.stockSource
      ? await deps
          .stockSource({ query: stockQueryFromBrief(brief), brief })
          .catch(() => null)
      : null;

  if (stockResult) {
    coverUrl = stockResult.coverUrl ?? stockResult.videoUrl;
    videoUrl = stockResult.videoUrl;
    emit("cover", { url: coverUrl, prompt: null, model: null, source: "stock" });
    emit("video", {
      url: videoUrl,
      type: "video",
      audioUsed: audio ?? null,
      source: "stock",
      provider: stockResult.provider,
      licence: stockResult.licence,
    });
  } else {
    // Image models (esp. Nano Banana/Gemini) fail transiently with "Failed to generate
    // image"; a passed idea-gate already cost an LLM call, so retry before giving up.
    // Best-of-N: render `coverVariants` candidates and animate only the strongest
    // (the frame everything downstream is built on). N=1 or no scorer ⇒ single cover.
    const coverCount = Math.max(1, ti.coverVariants ?? 1);
    const candidates = await Promise.all(
      Array.from({ length: coverCount }, () => withRetry(() => deps.media.generateAsset(coverPrompt))),
    );
    let cover = candidates[0]!;
    let coverScores: number[] | null = null;
    if (coverCount > 1 && deps.scoreCover) {
      coverScores = await Promise.all(
        candidates.map((c) => deps.scoreCover!(c.url, brief).catch(() => 0)),
      );
      let bestIdx = 0;
      for (let i = 1; i < coverScores.length; i++) {
        if (coverScores[i]! > coverScores[bestIdx]!) bestIdx = i;
      }
      cover = candidates[bestIdx]!;
    }
    emit("cover", {
      url: cover.url,
      prompt: coverPrompt,
      model: coverModel ?? null,
      ...(coverScores ? { candidates: coverScores } : {}),
    });

    // End-frame keyframe: render the final-beat frame so the video model has a
    // target to drive toward (steadier motion + a guaranteed payoff frame).
    // Best-effort — a failure falls back to start-frame-only.
    let endImage: string | undefined;
    if (ti.video.endFrame) {
      try {
        const end = await withRetry(() =>
          deps.media.generateAsset(resolveEndCoverPrompt(ti.assetStyle, brief, deps.promptOverrides)),
        );
        endImage = end.url;
      } catch {
        endImage = undefined;
      }
    }

    const video = await deps.media.generateVideo({
      prompt: videoPrompt,
      model: ti.video.model,
      startImage: cover.url,
      endImage,
      audio,
      durationSec: ti.video.durationSec,
      aspectRatio: brief.aspectRatio,
    });

    // Re-host ephemeral provider URLs (e.g. Replicate's expire in ~1h) to durable
    // URLs so a SCHEDULED Buffer reel can still fetch the media when it publishes.
    // When caption overlay is on, burn the brief's on-screen beats into the
    // generated clip (composeReusedClip hosts the result for us); else host as-is.
    coverUrl = await deps.mediaHost.persist(cover.url);
    const wantCaptions = ti.captionOverlay && deps.captionBurner && brief.onScreenText.length > 0;
    videoUrl = wantCaptions
      ? await deps.captionBurner!(video.url, brief.onScreenText, brief.durationSec)
      : await deps.mediaHost.persist(video.url);
    // Safety net: caption burning produces a local file that the media host must
    // upload to a reachable URL. If hosting couldn't (passthrough host, or upload
    // failed) we'd be left with a local /tmp path — fall back to the un-burned but
    // reachable hosted clip rather than publish something nobody can fetch.
    let captionsBurned = wantCaptions;
    if (wantCaptions && !/^https?:\/\//i.test(videoUrl)) {
      videoUrl = await deps.mediaHost.persist(video.url);
      captionsBurned = false;
    }
    emit("video", {
      url: videoUrl,
      type: "video",
      audioUsed: audio ?? null,
      prompt: videoPrompt,
      model: videoModel ?? null,
      captionsBurned,
      endFrameUsed: Boolean(endImage),
    });
  }

  // Virality scoring (Higgsfield brain_activity) is slow and needs a paid plan, so
  // it's opt-in. Disabled ⇒ unknown score ⇒ draft (the common path). A scoring outage
  // when enabled must not discard a rendered video — also treat as unknown ⇒ draft.
  let report2: ViralityReport;
  if (!ti.scoreVirality) {
    report2 = { score: null, reportUrl: null, raw: "(virality scoring disabled)" };
  } else if (ti.viralityScorer === "llm" && deps.scoreBrief) {
    // Free path: owl-alpha scores the plan (no paid Higgsfield plan / vision model).
    try {
      report2 = await deps.scoreBrief.score({ brief, exemplars });
    } catch (err) {
      report2 = { score: null, reportUrl: null, raw: `llm scoring failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  } else {
    try {
      report2 = await deps.scoreVideo(videoUrl);
    } catch (err) {
      report2 = { score: null, reportUrl: null, raw: `scoring failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  emit("virality", report2);
  const passed = passesViralityGate(report2, ti.viralityThreshold);
  // Duet/stitch is a manual in-app step, so always draft (never auto-queue).
  const duetPlan =
    ctx.sourceMode === "duet" ? buildDuetPlan(brief, ti.duetSourceUrl) : null;
  const saveToDraft = ti.saveToDraft || !passed || Boolean(duetPlan);

  const videoId = deps.id();
  const channels = config.publishing.channelsByPlatform;
  const targets = (Object.keys(channels) as PublishPlatform[]).filter((p) => channels[p]);
  let bufferPostId: string | null = null;
  let status: GeneratedVideo["status"] = passed ? "scored" : "draft";
  const published: { platform: PublishPlatform; channelId: string; postId: string }[] = [];

  if (deps.buffer.configured && targets.length) {
    // Fan the same rendered clip out to every configured platform, each with its
    // own caption formatting. Instagram posts as a Reel; the rest take the video
    // asset directly. The primary post (Instagram if present) anchors the DB row.
    for (const platform of targets) {
      const channelId = channels[platform]!;
      const post = await deps.buffer.createPost({
        channelId,
        text: formatCaptionForPlatform(platform, brief),
        videoUrl,
        thumbnailUrl: coverUrl,
        instagramType: platform === "instagram" ? "reel" : undefined,
        saveToDraft,
      });
      published.push({ platform, channelId, postId: post.id });
    }
    const primary = published.find((p) => p.platform === "instagram") ?? published[0]!;
    bufferPostId = primary.postId;
    status = saveToDraft ? "draft" : "queued";
  }
  emit("publish", {
    status,
    bufferPostId,
    saveToDraft,
    channelConfigured: targets.length > 0,
    platforms: published,
    duet: duetPlan,
  });

  db.insert(generatedVideos)
    .values({
      id: videoId,
      topic,
      brief: brief as unknown as Record<string, unknown>,
      exemplars: exemplars as unknown[],
      soundTrackUrl: audio ?? null,
      soundMood: brief.soundMood,
      coverImageUrl: coverUrl,
      videoUrl,
      viralityScore: report2.score,
      viralityReportUrl: report2.reportUrl,
      status,
      bufferPostId,
      createdAt: deps.now(),
    })
    .run();

  return {
    topic,
    videoId,
    videoUrl,
    viralityScore: report2.score,
    ideaScore,
    passed,
    status,
    bufferPostId,
    soundsCatalogued,
  };
}

/**
 * Run the full imitate→innovate pipeline for one topic in one shot (no review
 * pause): research/brief/judge, then immediately render if the idea clears
 * the gate. Below-threshold ideas return early with `status: "rejected"`.
 */
export async function runTrendImitation(
  db: DB,
  config: DecodeConfig,
  topic: string,
  deps: TrendImitationDeps,
): Promise<TrendImitationResult> {
  const phase1 = await runResearchPhase(db, config, topic, deps);
  if (!phase1.cleared) {
    return {
      topic: phase1.topic,
      videoId: "",
      videoUrl: "",
      viralityScore: null,
      ideaScore: phase1.judgment.score,
      passed: false,
      status: "rejected",
      bufferPostId: null,
      soundsCatalogued: phase1.soundsCatalogued,
    };
  }
  return runRenderPhase(db, config, deps, phase1.ctx);
}

/**
 * Build a runner that pulls *real* trending sounds from the TikTok Creative
 * Center connector, mapped to evidence-only SoundTrends. Returns undefined when
 * the connector is disabled in config (the default), so the music layer falls
 * back to its text-inferred sounds. These tracks are commercial — they are
 * catalogued as evidence and only ever reach `--audio` via the royalty-free
 * substitute produced by mapToSafeTrack.
 */
export function buildTiktokSoundRunner(
  config: DecodeConfig,
  env: Record<string, string | undefined> = process.env,
): ((topic: string) => Promise<SoundTrend[]>) | undefined {
  const baseCtx: ConnectorContext = {
    keywords: [],
    businessName: "",
    config: config.sources["tiktok_sounds"],
    env,
    fetchImpl: fetch,
  };
  if (!tiktokSoundsConnector.state(baseCtx).configured) return undefined;

  return async (topic) => {
    const signals = await tiktokSoundsConnector.fetch({
      ...baseCtx,
      keywords: [topic],
      businessName: topic,
    });
    return signals.map((s) =>
      makeSoundTrend(topic, "tiktok_sounds", {
        title: s.title,
        url: s.url,
        engagement: s.points ?? 0,
        soundId: s.externalId,
        author: s.author || undefined,
      }),
    );
  };
}

/**
 * Wire the production dependencies (real research/LLM/Higgsfield/Buffer clients).
 * When `db` is given, DB-backed prompt overrides are loaded and threaded into the
 * three LLM builders and `deps.promptOverrides` (used for the cover/video scaffolds).
 */
export function buildTrendImitationDeps(
  config: DecodeConfig,
  env: Record<string, string | undefined>,
  db?: DB,
): TrendImitationDeps {
  const tiktokRunner = buildTiktokSoundRunner(config, env);
  const coverScorer = getCoverScorer(env);
  // Saved DB overrides, with the per-run variant selection layered on top.
  const variantOverrides = resolveVariantTemplates(config.trendImitation.promptVariants, db);
  const promptOverrides =
    db || Object.keys(variantOverrides).length > 0
      ? { ...(db ? loadPromptOverrides(db) : {}), ...variantOverrides }
      : undefined;
  // The toggle is honored at runtime (DB settings), so wire the dep whenever we have a
  // DB and let runNotebookInsight return null when disabled/unconfigured. NotebookLM is
  // optional enrichment — its failure must never abort a render, so swallow + return null.
  const notebookInsight = db
    ? async (topic: string, report: RankedReport): Promise<NotebookInsightTrace | null> => {
        try {
          return await runNotebookInsight(
            db,
            config,
            topic,
            { sourceUrls: report.topPicks.map((p) => p.url) },
            buildNotebookInsightDeps(env, config, promptOverrides),
          );
        } catch (err) {
          console.warn(`[notebooklm] insight skipped: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      }
    : undefined;
  // Content-scraping research insight (opt-in via research.webResearch). Reads the
  // page bodies behind the top picks and distills a grounded insight — no NotebookLM
  // cookies/CLI needed. undefined when disabled or no OpenRouter key.
  const webResearcher = config.research.webResearch ? getWebResearchInsight(config, env) : undefined;
  const webResearchInsight = webResearcher
    ? (topic: string, report: RankedReport): Promise<WebResearchInsight | null> =>
        webResearcher
          .distill(topic, report.topPicks.map((p) => ({ url: p.url, title: p.title })))
          .catch(() => null)
    : undefined;
  return {
    research: async (topic) => {
      const raw = db
        ? await cachedResearchReport(db, topic, () => runLast30Days(topic))
        : await runLast30Days(topic);
      // Optional semantic rerank: embed the topic + item titles and blend cosine
      // similarity into relevance. Best-effort — no embedding key ⇒ keyword-only.
      let semanticScoresByUrl: Record<string, number> | undefined;
      if (config.research.semanticRerank) {
        const embedder = getEmbedder(env);
        if (embedder) {
          const items = Object.values(raw.itemsBySource)
            .flat()
            .map((it) => ({ key: it.url, text: `${it.title} ${it.snippet}` }));
          semanticScoresByUrl = await semanticScores(topic, items, embedder);
        }
      }
      const ranked = rankReport(raw, {
        keywords: config.keywords,
        multipliers: {},
        weights: config.research.rankWeights,
        halfLifeDays: config.research.halfLifeDays,
        topN: config.research.topN,
        semanticScores: semanticScoresByUrl,
      });
      // Capture pick thumbnails so the exemplar extractor can analyse the frames.
      return config.trendImitation.visionEnrichment ? enrichThumbnails(ranked) : ranked;
    },
    notebookInsight,
    webResearchInsight,
    extractor: getExemplarExtractor(
      { promptOverrides, vision: config.trendImitation.visionEnrichment },
      env,
    ),
    findSounds: (topic) => findTrendingSounds(topic, { tiktokRunner }),
    mapTrack: (trend) => mapToSafeTrack(trend, { provider: config.trendImitation.music.provider }),
    briefBuilder: getBriefBuilder(
      {
        aspectRatio: config.trendImitation.video.aspectRatio,
        voice: config.profile.voice,
        businessName: config.businessName,
        businessDescription: config.businessDescription,
        profile: config.profile,
        promptOverrides,
      },
      env,
    ),
    judge: getIdeaJudge(
      {
        voice: config.profile.voice,
        businessName: config.businessName,
        businessDescription: config.businessDescription,
        profile: config.profile,
        promptOverrides,
      },
      env,
    ),
    media: getMediaGenerator(config, env),
    stockSource: buildStockSource(
      env,
      getMediaHost(config.trendImitation.mediaHost),
      config.trendImitation.captionOverlay,
    ),
    mediaHost: getMediaHost(config.trendImitation.mediaHost),
    captionBurner: (videoUrl, beats, durationSec) =>
      composeReusedClip(videoUrl, defaultReuseDeps(getMediaHost(config.trendImitation.mediaHost)), {
        reframe: "none",
        captions: "beats",
        beats,
        durationSec,
      }),
    scoreVideo: (ref) => scoreVideoImpl(ref, { env }),
    scoreBrief: getBriefViralityScorer(env),
    scoreCover: coverScorer ? (url, brief) => coverScorer.score(url, brief) : undefined,
    buffer: createBufferClient(env),
    now: () => new Date().toISOString(),
    id: () => randomUUID(),
    promptOverrides,
  };
}

/**
 * Job entrypoint: refresh the reusable trending-music library for every
 * configured topic. Returns the number of tracks catalogued.
 */
export async function runMusicTrendsJob(db: DB, config: DecodeConfig): Promise<number> {
  if (!config.trendImitation.music.enabled) return 0;
  const now = new Date().toISOString();
  const tiktokRunner = buildTiktokSoundRunner(config);
  let total = 0;
  for (const topic of config.trendImitation.topics) {
    const sounds = await findTrendingSounds(topic, {
      runner: (q) => runLast30Days(q, { quick: true }),
      tiktokRunner,
    });
    for (const trend of sounds) {
      const safe = mapToSafeTrack(trend, { provider: config.trendImitation.music.provider });
      insertMusicTrack(db, topic, trend, safe, now, randomUUID());
      total++;
    }
  }
  return total;
}

/** Default topics processed concurrently — aligns with the 5-key OpenRouter pool. */
export const DEFAULT_BATCH_CONCURRENCY = 3;

/**
 * Job entrypoint: run the pipeline for every configured topic, several at a time
 * (bounded by `concurrency`) so a batch fans across the OpenRouter key pool
 * instead of running one topic at a time. Result order matches topic order.
 */
export async function runTrendImitationJob(
  db: DB,
  config: DecodeConfig,
  env: Record<string, string | undefined>,
  concurrency: number = DEFAULT_BATCH_CONCURRENCY,
): Promise<TrendImitationResult[]> {
  const deps = buildTrendImitationDeps(config, env, db);
  return mapWithConcurrency(config.trendImitation.topics, Math.max(1, concurrency), (topic) =>
    runTrendImitation(db, config, topic, deps),
  );
}

/** Per-run overrides for the new pipeline knobs, set from the dashboard. */
export type TrendRunOverrides = {
  sourceMode?: "generate" | "stock" | "duet";
  captionOverlay?: boolean;
  viralityScorer?: "higgsfield" | "llm";
  briefVariants?: number;
  duetSourceUrl?: string;
  /** per-stage prompt-variant selection ({promptKey: variantId}); resolved into prompt overrides. */
  promptVariants?: Record<string, string>;
  /** operator-pasted research used to ground the brief (in addition to discovery). */
  manualResearch?: string;
};

/** Merge per-run overrides onto the trend config; `viralityScorer` also enables scoring. */
export function applyTrendOverrides(
  ti: TrendImitationConfig,
  o: TrendRunOverrides,
): TrendImitationConfig {
  return {
    ...ti,
    ...(o.sourceMode ? { sourceMode: o.sourceMode } : {}),
    ...(o.captionOverlay !== undefined ? { captionOverlay: o.captionOverlay } : {}),
    ...(o.viralityScorer ? { viralityScorer: o.viralityScorer, scoreVirality: true } : {}),
    ...(o.briefVariants && o.briefVariants > 0 ? { briefVariants: o.briefVariants } : {}),
    ...(o.duetSourceUrl !== undefined ? { duetSourceUrl: o.duetSourceUrl } : {}),
    ...(o.promptVariants && Object.keys(o.promptVariants).length > 0
      ? { promptVariants: o.promptVariants }
      : {}),
    ...(o.manualResearch && o.manualResearch.trim() ? { manualResearch: o.manualResearch } : {}),
  };
}

export type TrendRunPayload = {
  runId: string;
  topic: string;
  assetStyle?: "standard" | "infographic";
  /** opt-in pause: stop after the decision gate and await an operator-triggered render. */
  reviewEnabled?: boolean;
  /** a Replicate "owner/model" (or "owner/model:version") id overriding the configured cover image model. */
  coverModel?: string;
  /** a Replicate "owner/model" (or "owner/model:version") id overriding the configured video model. */
  videoModel?: string;
  /** new pipeline knobs (sourceMode, captionOverlay, viralityScorer, briefVariants, duetSourceUrl). */
  overrides?: TrendRunOverrides;
};

/** Append one stage event to a trend_runs row's `stages` array. */
function appendStage(db: DB, runId: string, stage: TrendStage, data: unknown, now: string): void {
  const row = db.select().from(trendRuns).where(eq(trendRuns.id, runId)).get();
  const stages = [...(row?.stages ?? []), { stage, data }];
  db.update(trendRuns).set({ stages, updatedAt: now }).where(eq(trendRuns.id, runId)).run();
}

/**
 * Single-topic, web-triggered run that streams stage progress into the
 * `trend_runs` row identified by `payload.runId`. Catches its own errors
 * (records `status="failed"`) so the job never retries and double-spends.
 * When `payload.reviewEnabled` is set, stops after the decision gate with
 * `status="awaiting_review"` and the render context saved for later resume
 * via `runTrendRenderResume`.
 */
export async function runSingleTrendRun(
  db: DB,
  config: DecodeConfig,
  env: Record<string, string | undefined>,
  payload: TrendRunPayload,
  depsOverride?: TrendImitationDeps,
): Promise<void> {
  const { runId, topic, assetStyle, reviewEnabled, coverModel, videoModel, overrides } = payload;
  const override: MediaOverride = { assetStyle, coverModel, videoModel };
  let effectiveTi = config.trendImitation;
  if (assetStyle || coverModel || videoModel) effectiveTi = applyMediaOverride(effectiveTi, override);
  if (overrides) effectiveTi = applyTrendOverrides(effectiveTi, overrides);
  const effectiveConfig: DecodeConfig =
    effectiveTi === config.trendImitation ? config : { ...config, trendImitation: effectiveTi };

  db.update(trendRuns)
    .set({ status: "running", reviewEnabled: Boolean(reviewEnabled), updatedAt: new Date().toISOString() })
    .where(eq(trendRuns.id, runId))
    .run();

  const deps = depsOverride ?? buildTrendImitationDeps(effectiveConfig, env, db);
  deps.onStage = (stage, data) => appendStage(db, runId, stage, data, new Date().toISOString());

  try {
    const phase1 = await runResearchPhase(db, effectiveConfig, topic, deps);
    if (!phase1.cleared) {
      db.update(trendRuns)
        .set({ status: "ok", generatedVideoId: null, updatedAt: new Date().toISOString() })
        .where(eq(trendRuns.id, runId))
        .run();
      return;
    }

    if (reviewEnabled) {
      db.update(trendRuns)
        .set({
          status: "awaiting_review",
          renderContext: phase1.ctx as unknown as Record<string, unknown>,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(trendRuns.id, runId))
        .run();
      return;
    }

    const result = await runRenderPhase(db, effectiveConfig, deps, phase1.ctx);
    db.update(trendRuns)
      .set({
        status: "ok",
        generatedVideoId: result.videoId || null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(trendRuns.id, runId))
      .run();
  } catch (err) {
    db.update(trendRuns)
      .set({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(trendRuns.id, runId))
      .run();
  }
}

/**
 * Resume a paused (`status="awaiting_review"`) run: reads the saved
 * `RenderContext` off the `trend_runs` row (with any operator edits already
 * merged in by the caller — see `/api/trend/[runId]/render`), runs the render
 * phase, and records the final status. Catches its own errors for the same
 * reason as `runSingleTrendRun`.
 */
export async function runTrendRenderResume(
  db: DB,
  config: DecodeConfig,
  env: Record<string, string | undefined>,
  runId: string,
  depsOverride?: TrendImitationDeps,
): Promise<void> {
  const row = db.select().from(trendRuns).where(eq(trendRuns.id, runId)).get();
  const ctx = row?.renderContext as RenderContext | null | undefined;
  if (!ctx) {
    db.update(trendRuns)
      .set({ status: "failed", error: "no render context to resume from", updatedAt: new Date().toISOString() })
      .where(eq(trendRuns.id, runId))
      .run();
    return;
  }

  const effectiveConfig: DecodeConfig = {
    ...config,
    trendImitation: applyMediaOverride(config.trendImitation, {
      assetStyle: ctx.assetStyle,
      provider: ctx.mediaProvider,
      coverModel: ctx.coverModel,
      videoModel: ctx.videoModel,
    }),
  };

  db.update(trendRuns)
    .set({ status: "running", updatedAt: new Date().toISOString() })
    .where(eq(trendRuns.id, runId))
    .run();

  const deps = depsOverride ?? buildTrendImitationDeps(effectiveConfig, env, db);
  deps.onStage = (stage, data) => appendStage(db, runId, stage, data, new Date().toISOString());

  try {
    const result = await runRenderPhase(db, effectiveConfig, deps, ctx);
    db.update(trendRuns)
      .set({
        status: "ok",
        generatedVideoId: result.videoId || null,
        renderContext: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(trendRuns.id, runId))
      .run();
  } catch (err) {
    db.update(trendRuns)
      .set({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(trendRuns.id, runId))
      .run();
  }
}
