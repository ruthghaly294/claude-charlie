import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GenerateVideoOptions, HiggsfieldAsset, MediaGenerator } from "./higgsfieldClient";

export class MuapiApiError extends Error {}

export type MuapiExecResult = { stdout: string; stderr: string };
export type MuapiExec = (args: string[]) => Promise<MuapiExecResult>;

export type MuapiClientOptions = {
  /** muapi image model (e.g. "flux-schnell", "gpt-image-2"). */
  imageModel?: string;
  /** muapi video model (e.g. "seedance-2", "kling-v3-std", "veo3-fast"). */
  videoModel?: string;
  /** default vertical framing for cover + clip. */
  aspectRatio?: string;
  durationSec?: number;
};

const DEFAULT_IMAGE_MODEL = "flux-schnell";
const DEFAULT_VIDEO_MODEL = "seedance-2";
const DEFAULT_ASPECT_RATIO = "9:16";
const DEFAULT_DURATION_SEC = 8;

function defaultExec(args: string[]): Promise<MuapiExecResult> {
  return new Promise((resolve, reject) => {
    execFile("muapi", args, { timeout: 600_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve({ stdout, stderr });
    });
  });
}

/** muapi stores its API key in ~/.muapi/config.json after `muapi auth configure`. */
function defaultHasCliAuth(): boolean {
  return existsSync(join(homedir(), ".muapi", "config.json"));
}

/** Pull the first http(s) URL from muapi's --output-json (`{outputs:[url,...]}`) or raw text. */
function extractUrl(stdout: string): string | null {
  try {
    const json = JSON.parse(stdout) as unknown;
    const fromOutputs = (json as { outputs?: unknown }).outputs;
    if (Array.isArray(fromOutputs)) {
      const first = fromOutputs.find((o) => typeof o === "string" && /^https?:\/\//.test(o));
      if (typeof first === "string") return first;
    }
  } catch {
    // not JSON — fall through to a raw URL scan
  }
  return stdout.match(/https?:\/\/\S+/)?.[0] ?? null;
}

/**
 * MuAPI-backed media generator, wrapping the `muapi` CLI (alternative provider,
 * toggled via config.trend_imitation.provider === "muapi"). Like Replicate,
 * MuAPI accepts a public image URL directly (`video from-image -i <url>`), so the
 * cover frame needs no download. The provider-agnostic `model` param is ignored —
 * MuAPI uses its own model names from config (videoModel/imageModel).
 */
export function createMuapiClient(
  env: Record<string, string | undefined>,
  opts: MuapiClientOptions = {},
  exec: MuapiExec = defaultExec,
  hasCliAuth: () => boolean = defaultHasCliAuth,
): MediaGenerator {
  const configured = Boolean(env.MUAPI_API_KEY) || hasCliAuth();
  const aspect = opts.aspectRatio ?? DEFAULT_ASPECT_RATIO;

  async function run(args: string[]): Promise<string> {
    if (!configured) {
      throw new MuapiApiError("MuAPI is not configured (run `muapi auth configure` or set MUAPI_API_KEY)");
    }
    let result: MuapiExecResult;
    try {
      result = await exec(args);
    } catch (err) {
      throw new MuapiApiError(`MuAPI CLI failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const url = extractUrl(result.stdout);
    if (!url) {
      const detail = (result.stderr || result.stdout).trim();
      throw new MuapiApiError(`MuAPI returned no output URL${detail ? `: ${detail}` : ""}`);
    }
    return url;
  }

  return {
    configured,

    async generateAsset(prompt): Promise<HiggsfieldAsset> {
      const url = await run([
        "image",
        "generate",
        prompt,
        "-m",
        opts.imageModel ?? DEFAULT_IMAGE_MODEL,
        "-a",
        aspect,
        "--wait",
        "--output-json",
      ]);
      return { url, type: "image" };
    },

    async generateVideo({ prompt, startImage, durationSec, aspectRatio }: GenerateVideoOptions): Promise<HiggsfieldAsset> {
      const model = opts.videoModel ?? DEFAULT_VIDEO_MODEL;
      const dur = String(durationSec ?? opts.durationSec ?? DEFAULT_DURATION_SEC);
      const ar = aspectRatio ?? aspect;
      const args = startImage
        ? ["video", "from-image", prompt, "-i", startImage, "-m", model, "-D", dur, "-a", ar, "--wait", "--output-json"]
        : ["video", "generate", prompt, "-m", model, "-D", dur, "-a", ar, "--wait", "--output-json"];
      const url = await run(args);
      return { url, type: "video" };
    },
  };
}
