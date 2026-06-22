import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveLocalMedia } from "./mediaDownload";

export class HiggsfieldApiError extends Error {}

export type HiggsfieldEnv = Record<string, string | undefined>;

export type HiggsfieldAsset = { url: string; type: "image" | "video" };

export type HiggsfieldExecResult = { stdout: string; stderr: string };
export type HiggsfieldExec = (args: string[]) => Promise<HiggsfieldExecResult>;

/**
 * Resolve a media reference into something the CLI accepts. The Higgsfield CLI
 * takes a local file path or a UUID — NOT a remote URL — so an http(s) ref is
 * downloaded to a temp file and that path is returned. Paths/UUIDs pass through.
 */
export type MediaResolver = (ref: string) => Promise<string>;

/** Options for a short-form video generation via seedance_2_0 (or another model). */
export type GenerateVideoOptions = {
  prompt: string;
  /** model/job-set-type override (e.g. "kling3_0"); defaults to seedance_2_0. */
  model?: string;
  /** first-frame reference for image-to-video: a local path or a Higgsfield job/upload id. */
  startImage?: string;
  /** optional last-frame keyframe: the video animates toward this frame (models that support it). */
  endImage?: string;
  /** soundtrack reference (role `audio`): a local path or id. Royalty-free/CC/owned audio only. */
  audio?: string;
  durationSec?: number;
  aspectRatio?: string;
};

export type HiggsfieldClient = {
  configured: boolean;
  generateAsset(prompt: string): Promise<HiggsfieldAsset>;
  generateVideo(opts: GenerateVideoOptions): Promise<HiggsfieldAsset>;
};

/**
 * Provider-agnostic media generator contract. Higgsfield and Replicate clients
 * both satisfy this, so the pipeline can toggle between providers.
 */
export type MediaGenerator = HiggsfieldClient;

// z_image: cheap/fast model (~0.15 credits/image on the free plan), vs.
// gpt_image_2's 7 credits — keeps the asset-generation step affordable.
const ASSET_MODEL = "z_image";
// Must match VIDEO_ASPECT_RATIO: this image becomes the video's startImage
// (see generateVideo's startImage param), so a mismatched ratio here would
// hand the video model a cropped/letterboxed first frame.
const ASSET_ASPECT_RATIO = "9:16";

// seedance_2_0: SOTA all-purpose short-form video. Vertical 9:16 for Reels/TikTok/
// Shorts; ~8s keeps generation fast/affordable while leaving room for a hook + payoff.
const VIDEO_MODEL = "seedance_2_0";
const VIDEO_ASPECT_RATIO = "9:16";
const VIDEO_DURATION_SEC = 8;

function defaultExec(args: string[]): Promise<HiggsfieldExecResult> {
  return new Promise((resolve, reject) => {
    execFile("higgsfield", args, { timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve({ stdout, stderr });
    });
  });
}

function defaultHasCliAuth(): boolean {
  return existsSync(join(homedir(), ".config", "higgsfield", "credentials.json"));
}

function extractAssetUrl(output: string): string | null {
  return output.match(/https?:\/\/\S+/)?.[0] ?? null;
}

const defaultResolveMedia: MediaResolver = (ref) => resolveLocalMedia(ref);

/**
 * Higgsfield-backed digital asset generator. `configured` reflects either
 * HIGGSFIELD_API_KEY or an authenticated `higgsfield` CLI session (`higgsfield
 * auth login`) — the CLI is the only proven integration path, since Higgsfield
 * does not (yet) expose a documented REST API/static key.
 */
export function createHiggsfieldClient(
  env: HiggsfieldEnv,
  exec: HiggsfieldExec = defaultExec,
  hasCliAuth: () => boolean = defaultHasCliAuth,
  resolveMedia: MediaResolver = defaultResolveMedia,
): HiggsfieldClient {
  const configured = Boolean(env.HIGGSFIELD_API_KEY) || hasCliAuth();

  async function generate(args: string[]): Promise<string> {
    if (!configured) {
      throw new HiggsfieldApiError(
        "Higgsfield is not configured (run `higgsfield auth login` or set HIGGSFIELD_API_KEY)",
      );
    }

    let result: HiggsfieldExecResult;
    try {
      result = await exec(args);
    } catch (err) {
      throw new HiggsfieldApiError(
        `Higgsfield CLI failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const url = extractAssetUrl(result.stdout);
    if (!url) {
      const detail = (result.stderr || result.stdout).trim();
      throw new HiggsfieldApiError(
        `Higgsfield did not return an asset URL${detail ? `: ${detail}` : ""}`,
      );
    }
    return url;
  }

  return {
    configured,

    async generateAsset(prompt) {
      const url = await generate([
        "generate",
        "create",
        ASSET_MODEL,
        "--prompt",
        prompt,
        "--aspect_ratio",
        ASSET_ASPECT_RATIO,
        "--wait",
      ]);
      return { url, type: "image" };
    },

    async generateVideo({ prompt, model, startImage, audio, durationSec, aspectRatio }) {
      const args = ["generate", "create", model ?? VIDEO_MODEL, "--prompt", prompt];
      if (startImage) args.push("--start-image", await resolveMedia(startImage));
      if (audio) args.push("--audio", await resolveMedia(audio));
      args.push("--duration", String(durationSec ?? VIDEO_DURATION_SEC));
      args.push("--aspect_ratio", aspectRatio ?? VIDEO_ASPECT_RATIO);
      args.push("--wait");

      const url = await generate(args);
      return { url, type: "video" };
    },
  };
}
