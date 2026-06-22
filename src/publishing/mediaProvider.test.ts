import { describe, it, expect, vi } from "vitest";
import { getMediaGenerator, applyMediaOverride, describeMediaSelection } from "./mediaProvider";
import * as replicate from "./replicateClient";
import type { DecodeConfig, TrendImitationConfig } from "@/discovery/config";

function baseTi(provider: TrendImitationConfig["provider"] = "higgsfield"): TrendImitationConfig {
  return {
    topics: [],
    provider,
    replicate: {
      imageModel: "black-forest-labs/flux-schnell",
      videoModel: "minimax/video-01",
      videoImageKey: "first_frame_image",
      infographicModel: "google/nano-banana",
    },
    assetStyle: "standard",
    sourceMode: "generate",
    captionOverlay: false,
    muapi: { imageModel: "muapi/image-default", videoModel: "muapi/video-default" },
    video: { aspectRatio: "9:16", durationSec: 8, model: "default-video-model", endFrame: false },
    coverVariants: 1,
    music: { enabled: true, provider: "youtube_audio_library" },
    mediaHost: "none",
    viralityThreshold: 60,
    scoreVirality: false,
    viralityScorer: "higgsfield",
    ideaThreshold: 40,
    briefVariants: 1,
    visionEnrichment: false,
    saveToDraft: true,
    brand: {
      handle: "",
      name: "",
      description: "",
      voice: "",
      audience: "",
      signupUrl: "",
      ctaPrimary: "",
      ctaSecondary: "",
      contentPillars: [],
    },
  };
}

function configWith(assetStyle: "standard" | "infographic"): DecodeConfig {
  return {
    trendImitation: {
      provider: "replicate",
      assetStyle,
      replicate: {
        imageModel: "black-forest-labs/flux-schnell",
        videoModel: "minimax/video-01",
        videoImageKey: "first_frame_image",
        infographicModel: "google/nano-banana",
      },
    },
  } as unknown as DecodeConfig;
}

describe("getMediaGenerator asset style", () => {
  it("uses the standard image model + 9:16 by default (must match the video it seeds)", () => {
    const spy = vi.spyOn(replicate, "createReplicateClient").mockReturnValue({} as never);
    getMediaGenerator(configWith("standard"), { REPLICATE_API_TOKEN: "t" });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ imageModel: "black-forest-labs/flux-schnell", imageAspectRatio: "9:16" }),
    );
    spy.mockRestore();
  });

  it("uses the infographic model (Nano Banana) + 9:16 when assetStyle is infographic", () => {
    const spy = vi.spyOn(replicate, "createReplicateClient").mockReturnValue({} as never);
    getMediaGenerator(configWith("infographic"), { REPLICATE_API_TOKEN: "t" });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ imageModel: "google/nano-banana", imageAspectRatio: "9:16" }),
    );
    spy.mockRestore();
  });
});

describe("describeMediaSelection", () => {
  it("reports no model fields for higgsfield (CLI-based, no per-model config)", () => {
    expect(describeMediaSelection(baseTi("higgsfield"))).toEqual({ provider: "higgsfield" });
  });

  it("reports the standard image model for replicate + standard assetStyle", () => {
    const sel = describeMediaSelection(baseTi("replicate"));
    expect(sel).toEqual({
      provider: "replicate",
      coverModel: "black-forest-labs/flux-schnell",
      videoModel: "minimax/video-01",
    });
  });

  it("reports the infographic model for replicate + infographic assetStyle", () => {
    const ti = { ...baseTi("replicate"), assetStyle: "infographic" as const };
    expect(describeMediaSelection(ti).coverModel).toBe("google/nano-banana");
  });

  it("reports the muapi models for provider=muapi", () => {
    expect(describeMediaSelection(baseTi("muapi"))).toEqual({
      provider: "muapi",
      coverModel: "muapi/image-default",
      videoModel: "muapi/video-default",
    });
  });
});

describe("applyMediaOverride", () => {
  it("leaves the config untouched when the override is empty", () => {
    const ti = baseTi("higgsfield");
    expect(applyMediaOverride(ti, {})).toEqual(ti);
  });

  it("switches provider to replicate when a coverModel is picked, even if the base provider was higgsfield", () => {
    const next = applyMediaOverride(baseTi("higgsfield"), { coverModel: "black-forest-labs/flux-1.1-pro" });
    expect(next.provider).toBe("replicate");
    expect(next.replicate.imageModel).toBe("black-forest-labs/flux-1.1-pro");
  });

  it("switches provider to replicate when only a videoModel is picked", () => {
    const next = applyMediaOverride(baseTi("higgsfield"), { videoModel: "kwaivgi/kling-v1.6-pro" });
    expect(next.provider).toBe("replicate");
    expect(next.replicate.videoModel).toBe("kwaivgi/kling-v1.6-pro");
  });

  it("overrides both replicate.imageModel and replicate.infographicModel from coverModel", () => {
    const next = applyMediaOverride(baseTi("replicate"), { coverModel: "ideogram-ai/ideogram-v2" });
    expect(next.replicate.imageModel).toBe("ideogram-ai/ideogram-v2");
    expect(next.replicate.infographicModel).toBe("ideogram-ai/ideogram-v2");
  });

  it("overrides muapi models when provider is explicitly muapi", () => {
    const next = applyMediaOverride(baseTi("muapi"), {
      provider: "muapi",
      coverModel: "custom/image",
      videoModel: "custom/video",
    });
    expect(next.muapi).toEqual({ imageModel: "custom/image", videoModel: "custom/video" });
  });

  it("leaves provider alone (no implicit replicate switch) when neither coverModel nor videoModel is set", () => {
    const next = applyMediaOverride(baseTi("higgsfield"), { assetStyle: "infographic" });
    expect(next.provider).toBe("higgsfield");
    expect(next.assetStyle).toBe("infographic");
  });

  it("restores an explicit provider (review-pause resume) without forcing replicate", () => {
    const next = applyMediaOverride(baseTi("replicate"), { provider: "higgsfield" });
    expect(next.provider).toBe("higgsfield");
  });
});
