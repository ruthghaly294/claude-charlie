import type { GenerateVideoOptions, HiggsfieldAsset, MediaGenerator } from "./higgsfieldClient";

export class ReplicateApiError extends Error {}

const API_BASE = "https://api.replicate.com/v1";

// Sensible defaults; override per account via config (trend_imitation.replicate.*).
const DEFAULT_IMAGE_MODEL = "black-forest-labs/flux-schnell";
const DEFAULT_VIDEO_MODEL = "minimax/video-01";
const DEFAULT_VIDEO_IMAGE_KEY = "first_frame_image";
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_POLLS = 150;
const DEFAULT_MAX_RETRIES = 6;
const DEFAULT_RETRY_MS = 10_000;

export type ReplicateClientOptions = {
  imageModel?: string;
  /** aspect ratio sent to the image (cover) model. Default "16:9". */
  imageAspectRatio?: string;
  videoModel?: string;
  /** input key a video model expects for the first-frame image (model-specific). */
  videoImageKey?: string;
  /** input key for the optional last-frame keyframe (e.g. "last_frame_image"); unset ⇒ no end frame. */
  videoEndImageKey?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
  /** retries on HTTP 429 (rate limit), respecting Retry-After. Default 6. */
  maxRetries?: number;
};

type Prediction = {
  status?: string;
  output?: unknown;
  error?: string | null;
  urls?: { get?: string };
};

/** Pull the first http(s) URL out of a Replicate `output` (string | string[] | object). */
function extractUrl(output: unknown): string | null {
  if (typeof output === "string") return output.match(/^https?:\/\//) ? output : null;
  if (Array.isArray(output)) {
    for (let i = output.length - 1; i >= 0; i--) {
      const u = extractUrl(output[i]);
      if (u) return u;
    }
    return null;
  }
  if (output && typeof output === "object") return extractUrl(Object.values(output));
  return null;
}

/**
 * Replicate-backed media generator (alternative to Higgsfield, toggled via
 * config.trend_imitation.provider). Unlike Higgsfield, Replicate accepts a public
 * image URL directly as a model input, so the cover frame needs no download.
 * Input schemas vary per model — set the model ids (and `videoImageKey`) to match
 * the model you choose. A `model` containing ':' is treated as `owner/name:version`.
 */
export function createReplicateClient(
  env: Record<string, string | undefined>,
  opts: ReplicateClientOptions = {},
): MediaGenerator {
  const token = env.REPLICATE_API_TOKEN;
  const configured = Boolean(token);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPolls = opts.maxPolls ?? DEFAULT_MAX_POLLS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;

  function headers(): Record<string, string> {
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait" };
  }

  function retryAfterMs(res: Response): number {
    const raw = Number(res.headers?.get?.("retry-after"));
    return Number.isFinite(raw) && raw > 0 ? raw * 1000 : DEFAULT_RETRY_MS;
  }

  async function asJson(res: Response): Promise<Prediction> {
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new ReplicateApiError(`Replicate request failed (${res.status})${detail ? `: ${detail}` : ""}`);
    }
    return (await res.json()) as Prediction;
  }

  /** fetch with bounded retry on 429 (rate limit), honoring Retry-After. */
  async function call(url: string, init: RequestInit): Promise<Prediction> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, init);
      if (res.status === 429 && attempt < maxRetries) {
        await sleep(retryAfterMs(res));
        continue;
      }
      return asJson(res);
    }
  }

  /** owner/name → official-model endpoint; owner/name:version → version endpoint. */
  function startBody(model: string, input: Record<string, unknown>): { url: string; body: string } {
    const colon = model.indexOf(":");
    if (colon !== -1) {
      return { url: `${API_BASE}/predictions`, body: JSON.stringify({ version: model.slice(colon + 1), input }) };
    }
    return { url: `${API_BASE}/models/${model}/predictions`, body: JSON.stringify({ input }) };
  }

  async function run(model: string, input: Record<string, unknown>): Promise<string> {
    if (!configured) {
      throw new ReplicateApiError("Replicate is not configured (set REPLICATE_API_TOKEN)");
    }
    const { url, body } = startBody(model, input);
    let prediction = await call(url, { method: "POST", headers: headers(), body });

    for (let i = 0; i < maxPolls && (prediction.status === "starting" || prediction.status === "processing"); i++) {
      const get = prediction.urls?.get;
      if (!get) break;
      await sleep(pollIntervalMs);
      prediction = await call(get, { headers: headers() });
    }

    if (prediction.status !== "succeeded") {
      throw new ReplicateApiError(prediction.error || `Replicate prediction status: ${prediction.status ?? "unknown"}`);
    }
    const out = extractUrl(prediction.output);
    if (!out) throw new ReplicateApiError("Replicate prediction returned no output URL");
    return out;
  }

  return {
    configured,

    async generateAsset(prompt): Promise<HiggsfieldAsset> {
      const url = await run(opts.imageModel ?? DEFAULT_IMAGE_MODEL, {
        prompt,
        aspect_ratio: opts.imageAspectRatio ?? "16:9",
      });
      return { url, type: "image" };
    },

    async generateVideo({ prompt, startImage, endImage }: GenerateVideoOptions): Promise<HiggsfieldAsset> {
      const imageKey = opts.videoImageKey ?? DEFAULT_VIDEO_IMAGE_KEY;
      const input: Record<string, unknown> = { prompt };
      if (startImage) input[imageKey] = startImage;
      // Last-frame keyframe: only sent when the model is configured with an end-image key.
      if (endImage && opts.videoEndImageKey) input[opts.videoEndImageKey] = endImage;
      const url = await run(opts.videoModel ?? DEFAULT_VIDEO_MODEL, input);
      return { url, type: "video" };
    },
  };
}
