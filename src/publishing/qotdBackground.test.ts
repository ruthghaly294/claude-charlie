import { describe, it, expect, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { getBrandBackground } from "./qotdBackground";
import { SLIDE_H, SLIDE_W } from "./qotdSlides";
import type { MediaGenerator } from "./higgsfieldClient";

async function tinyPng(): Promise<Buffer> {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: "#cdb" } }).png().toBuffer();
}

function fakeGenerator(over: Partial<MediaGenerator> = {}): MediaGenerator {
  return {
    configured: true,
    generateAsset: vi.fn(async () => ({ url: "https://img/bg.png", type: "image" as const })),
    generateVideo: vi.fn(),
    ...over,
  } as unknown as MediaGenerator;
}

async function tmpCachePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "qotd-bg-"));
  return join(dir, "bg.png");
}

describe("getBrandBackground", () => {
  it("returns null (gradient fallback) when no generator is configured", async () => {
    const bg = await getBrandBackground({ generator: null, cachePath: await tmpCachePath() });
    expect(bg).toBeNull();
  });

  it("generates, resizes to the slide canvas, and caches; reuses cache on the next call", async () => {
    const png = await tinyPng();
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(png)));
    const generator = fakeGenerator();
    const cachePath = await tmpCachePath();

    const first = await getBrandBackground({ generator, fetchImpl, cachePath });
    expect(first).not.toBeNull();
    const meta = await sharp(first!).metadata();
    expect(meta.width).toBe(SLIDE_W);
    expect(meta.height).toBe(SLIDE_H);
    expect(generator.generateAsset).toHaveBeenCalledTimes(1);

    // Second call hits the on-disk cache — generator/fetch are not called again.
    const second = await getBrandBackground({ generator, fetchImpl, cachePath });
    expect(second).not.toBeNull();
    expect(generator.generateAsset).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refresh:true regenerates even when a cache exists", async () => {
    const png = await tinyPng();
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(png)));
    const generator = fakeGenerator();
    const cachePath = await tmpCachePath();

    await getBrandBackground({ generator, fetchImpl, cachePath });
    await getBrandBackground({ generator, fetchImpl, cachePath, refresh: true });
    expect(generator.generateAsset).toHaveBeenCalledTimes(2);
  });

  describe("durable R2 cache", () => {
    const okResponse = (png: Buffer) => async () => new Response(new Uint8Array(png));

    it("returns the R2-cached background without generating when the public URL hits", async () => {
      const png = await tinyPng();
      const fetchImpl = vi.fn(okResponse(png)); // GET of the cache URL succeeds
      const upload = vi.fn(async () => {});
      const generator = fakeGenerator();

      const bg = await getBrandBackground({
        generator,
        fetchImpl,
        r2: { publicBaseUrl: "https://pub.example.com/", upload },
      });

      expect(bg).not.toBeNull();
      expect(generator.generateAsset).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
      expect(fetchImpl).toHaveBeenCalledWith("https://pub.example.com/brand-bg/qotd-1080x1350.png");
    });

    it("generates, resizes, and uploads under a stable key on a cache miss", async () => {
      const png = await tinyPng();
      // First fetch = cache check (404); second fetch = downloading the generated asset.
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(new Response("nope", { status: 404 }))
        .mockResolvedValueOnce(new Response(new Uint8Array(png)));
      const upload = vi.fn(async (_args: { key: string; bytes: Uint8Array; contentType: string }) => {});
      const generator = fakeGenerator();

      const bg = await getBrandBackground({
        generator,
        fetchImpl,
        r2: { publicBaseUrl: "https://pub.example.com", upload },
      });

      expect(bg).not.toBeNull();
      const meta = await sharp(bg!).metadata();
      expect(meta.width).toBe(SLIDE_W);
      expect(meta.height).toBe(SLIDE_H);
      expect(generator.generateAsset).toHaveBeenCalledTimes(1);
      expect(upload).toHaveBeenCalledTimes(1);
      expect(upload.mock.calls[0]![0]).toMatchObject({ key: "brand-bg/qotd-1080x1350.png", contentType: "image/png" });
    });
  });

  it("uses the text-free brand-background prompt", async () => {
    const png = await tinyPng();
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(png)));
    const generator = fakeGenerator();
    await getBrandBackground({ generator, fetchImpl, cachePath: await tmpCachePath() });
    const prompt = (generator.generateAsset as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(prompt).toMatch(/NO text|no words/i);
  });
});
