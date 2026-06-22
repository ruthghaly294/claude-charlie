import { describe, it, expect } from "vitest";
import { IMAGE_MODELS, VIDEO_MODELS, findImageModel, findVideoModel, isValidCustomModel, resolveModelSelection } from "./mediaModels";

describe("findImageModel / findVideoModel", () => {
  it("finds a catalog entry by key", () => {
    const image = IMAGE_MODELS[0]!;
    const video = VIDEO_MODELS[0]!;
    expect(findImageModel(image.key)).toEqual(image);
    expect(findVideoModel(video.key)).toEqual(video);
  });

  it("returns undefined for an unknown key", () => {
    expect(findImageModel("not-a-real-key")).toBeUndefined();
    expect(findVideoModel("not-a-real-key")).toBeUndefined();
  });
});

describe("isValidCustomModel", () => {
  it("accepts owner/model", () => {
    expect(isValidCustomModel("black-forest-labs/flux-dev")).toBe(true);
  });

  it("accepts owner/model:version", () => {
    expect(isValidCustomModel("owner/model:abc123")).toBe(true);
  });

  it("rejects strings with no slash", () => {
    expect(isValidCustomModel("not-a-slug")).toBe(false);
  });

  it("rejects empty/whitespace", () => {
    expect(isValidCustomModel("   ")).toBe(false);
  });

  it("rejects a slug carrying a URL or query-like suffix", () => {
    expect(isValidCustomModel("owner/model?evil=1")).toBe(false);
    expect(isValidCustomModel("owner/model/extra")).toBe(false);
  });
});

describe("resolveModelSelection", () => {
  it("returns no override for an undefined key", () => {
    expect(resolveModelSelection("image", undefined, undefined)).toEqual({ ok: true, model: undefined });
  });

  it('returns no override for key "auto"', () => {
    expect(resolveModelSelection("video", "auto", undefined)).toEqual({ ok: true, model: undefined });
  });

  it("resolves a catalog key to its model id", () => {
    const image = IMAGE_MODELS[0]!;
    const result = resolveModelSelection("image", image.key, undefined);
    expect(result).toEqual({ ok: true, model: image.model });
  });

  it("errors on an unknown catalog key", () => {
    const result = resolveModelSelection("video", "totally-made-up", undefined);
    expect(result.ok).toBe(false);
  });

  it('resolves "custom" with a valid slug', () => {
    const result = resolveModelSelection("image", "custom", "owner/model:v1");
    expect(result).toEqual({ ok: true, model: "owner/model:v1" });
  });

  it('errors on "custom" with a blank value', () => {
    const result = resolveModelSelection("image", "custom", "  ");
    expect(result.ok).toBe(false);
  });

  it('errors on "custom" with a malformed slug', () => {
    const result = resolveModelSelection("video", "custom", "not-a-slug");
    expect(result.ok).toBe(false);
  });
});
