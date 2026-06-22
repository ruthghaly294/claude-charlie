import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";
import type { MediaGenerator } from "./higgsfieldClient";
import type { R2Uploader } from "./mediaHost";
import { resolvePrompt } from "./prompts";
import { SLIDE_H, SLIDE_W } from "./qotdSlides";

/**
 * Durable (R2) cache for the brand background, so it survives ephemeral/serverless
 * cold starts and is generated truly once — not once per instance. Existence is
 * checked by fetching the public URL (no S3 GET creds needed); on a miss the bytes
 * are PUT under a stable key via `upload`.
 */
export type R2BackgroundCache = {
  /** Public base URL for the bucket (no trailing slash), e.g. an r2.dev or custom domain. */
  publicBaseUrl: string;
  upload: R2Uploader;
  /** Stable object key. Default: brand-bg/qotd-<W>x<H>.png. */
  key?: string;
};

export type BrandBackgroundDeps = {
  /** Image generator (e.g. Replicate + Nano Banana Pro). Null/unconfigured ⇒ no background. */
  generator?: MediaGenerator | null;
  /** Fetches the generated image URL (and the R2 cache URL) into bytes. Default: global fetch. */
  fetchImpl?: typeof fetch;
  /** Durable R2 cache (preferred for production). When set, the local-disk cache is bypassed. */
  r2?: R2BackgroundCache;
  /** Local-disk cache path (used when `r2` is absent). Default: <cwd>/data/brand-bg/qotd-<W>x<H>.png. */
  cachePath?: string;
  /** Force regeneration even if a cached background exists. */
  refresh?: boolean;
  /** DB-backed prompt overrides for "infographic.brandBackground". */
  overrides?: Record<string, string>;
};

function defaultCachePath(): string {
  return join(process.cwd(), "data", "brand-bg", `qotd-${SLIDE_W}x${SLIDE_H}.png`);
}

function defaultKey(): string {
  return `brand-bg/qotd-${SLIDE_W}x${SLIDE_H}.png`;
}

/** Generate the text-free brand background and resize it to the slide canvas. Null if no generator. */
async function generateSized(deps: BrandBackgroundDeps): Promise<Buffer | null> {
  if (!deps.generator?.configured) return null;
  const prompt = resolvePrompt("infographic.brandBackground", {}, deps.overrides);
  const asset = await deps.generator.generateAsset(prompt);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(asset.url);
  if (!res.ok) throw new Error(`brand background fetch failed (${res.status})`);
  const raw = Buffer.from(await res.arrayBuffer());
  return sharp(raw).resize(SLIDE_W, SLIDE_H, { fit: "cover", position: "centre" }).png().toBuffer();
}

/**
 * Resolve ONE standardized, on-brand watercolor background sized to the slide
 * canvas, so every post shares the same brand look. The background is generated
 * once via the image model (text-free — see the "infographic.brandBackground"
 * prompt) then cached and reused. Prefers a durable R2 cache (survives serverless
 * cold starts); otherwise caches to local disk. Returns null when no generator is
 * configured, so the renderer falls back to the brand gradient. The background
 * carries NO text; deterministic SVG text is composited over it by the renderer,
 * keeping medical statements verbatim.
 */
export async function getBrandBackground(deps: BrandBackgroundDeps): Promise<Buffer | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;

  if (deps.r2) {
    const key = deps.r2.key ?? defaultKey();
    const url = `${deps.r2.publicBaseUrl.replace(/\/+$/, "")}/${key}`;
    if (!deps.refresh) {
      try {
        const hit = await fetchImpl(url);
        if (hit.ok) return Buffer.from(await hit.arrayBuffer());
      } catch {
        // cache miss / transient error → generate below
      }
    }
    const sized = await generateSized(deps);
    if (!sized) return null;
    await deps.r2.upload({ key, bytes: sized, contentType: "image/png" });
    return sized;
  }

  const cachePath = deps.cachePath ?? defaultCachePath();
  if (!deps.refresh && existsSync(cachePath)) return readFile(cachePath);
  const sized = await generateSized(deps);
  if (!sized) return null;
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, sized);
  return sized;
}
