import type { DecodeConfig, TrendImitationConfig } from "@/discovery/config";
import { createHiggsfieldClient, type MediaGenerator } from "./higgsfieldClient";
import { createReplicateClient } from "./replicateClient";
import { createMuapiClient } from "./muapiClient";

/**
 * Describe which provider/model `getMediaGenerator` will actually construct a
 * client with — the single source of truth both `getMediaGenerator` and callers
 * that need to *record* the resolved selection (RenderContext, stage events) use,
 * so the two can never drift apart.
 */
export function describeMediaSelection(
  ti: TrendImitationConfig,
): { provider: TrendImitationConfig["provider"]; coverModel?: string; videoModel?: string } {
  if (ti.provider === "replicate") {
    const infographic = ti.assetStyle === "infographic";
    return {
      provider: ti.provider,
      // Infographic covers render on the infographic model (Nano Banana) so the
      // cover matches the 9:16 reel's data-viz style.
      coverModel: infographic ? ti.replicate.infographicModel : ti.replicate.imageModel,
      videoModel: ti.replicate.videoModel,
    };
  }
  if (ti.provider === "muapi") {
    return { provider: ti.provider, coverModel: ti.muapi.imageModel, videoModel: ti.muapi.videoModel };
  }
  return { provider: ti.provider };
}

/**
 * Select the media generator backing cover/video generation, per
 * config.trend_imitation.provider. Both clients satisfy MediaGenerator, so the
 * orchestrator is provider-agnostic.
 */
export function getMediaGenerator(
  config: DecodeConfig,
  env: Record<string, string | undefined>,
): MediaGenerator {
  const ti = config.trendImitation;
  const selection = describeMediaSelection(ti);
  if (ti.provider === "replicate") {
    return createReplicateClient(env, {
      imageModel: selection.coverModel,
      // Must match the video's aspect ratio: this image becomes the video's
      // startImage, so a mismatched ratio here hands the video model a
      // cropped/letterboxed first frame.
      imageAspectRatio: "9:16",
      videoModel: selection.videoModel,
      videoImageKey: ti.replicate.videoImageKey,
      videoEndImageKey: ti.replicate.videoEndImageKey,
    });
  }
  if (ti.provider === "muapi") {
    return createMuapiClient(env, {
      imageModel: selection.coverModel,
      videoModel: selection.videoModel,
      aspectRatio: ti.video.aspectRatio,
      durationSec: ti.video.durationSec,
    });
  }
  return createHiggsfieldClient(env);
}

/** A per-run override of cover/video style or model, applied on top of the configured defaults. */
export type MediaOverride = {
  assetStyle?: "standard" | "infographic";
  /** explicit provider restore (used when resuming a paused run); not for direct client input. */
  provider?: TrendImitationConfig["provider"];
  /** a Replicate "owner/model" (or "owner/model:version") id for the cover image. */
  coverModel?: string;
  /** a Replicate "owner/model" (or "owner/model:version") id for the video. */
  videoModel?: string;
};

/**
 * Merge a per-run `MediaOverride` onto the configured `TrendImitationConfig`.
 * Choosing a `coverModel`/`videoModel` (without an explicit `provider`) implies
 * `provider: "replicate"` for this run — that's the whole point of picking a
 * specific model on the dashboard. `provider` is only passed explicitly when
 * restoring a previously-resolved provider across a review-pause boundary (see
 * `RenderContext.mediaProvider` in runTrendImitation.ts).
 */
export function applyMediaOverride(ti: TrendImitationConfig, override: MediaOverride): TrendImitationConfig {
  const provider = override.provider ?? (override.coverModel || override.videoModel ? "replicate" : ti.provider);
  const next: TrendImitationConfig = { ...ti, provider, assetStyle: override.assetStyle ?? ti.assetStyle };
  if (provider === "replicate") {
    next.replicate = {
      ...ti.replicate,
      imageModel: override.coverModel ?? ti.replicate.imageModel,
      infographicModel: override.coverModel ?? ti.replicate.infographicModel,
      videoModel: override.videoModel ?? ti.replicate.videoModel,
    };
  } else if (provider === "muapi") {
    next.muapi = {
      ...ti.muapi,
      imageModel: override.coverModel ?? ti.muapi.imageModel,
      videoModel: override.videoModel ?? ti.muapi.videoModel,
    };
  }
  if (override.videoModel) next.video = { ...ti.video, model: override.videoModel };
  return next;
}
