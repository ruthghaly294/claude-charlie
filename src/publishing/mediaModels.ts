/**
 * Curated Replicate model options surfaced as one-click choices on the trend
 * dashboard. Best-effort as of this codebase's last knowledge update — Replicate's
 * catalog, slugs, and pricing change over time. Verify at
 * https://replicate.com/explore before a real (paid) run; if a slug has moved,
 * either edit it here or use the dashboard's "custom model" field, which accepts
 * any "owner/model" or "owner/model:version" string directly.
 */
export type MediaModelOption = {
  /** stable key sent by the frontend; the API resolves it to `model` server-side. */
  key: string;
  label: string;
  /** the literal Replicate model id passed to the API. */
  model: string;
  /** rough relative cost tier, shown in the UI so operators know what they're opting into. */
  tier: "$" | "$$" | "$$$";
  note?: string;
};

export const IMAGE_MODELS: MediaModelOption[] = [
  {
    key: "flux-schnell",
    label: "Flux Schnell",
    model: "black-forest-labs/flux-schnell",
    tier: "$",
    note: "fast, current Replicate default",
  },
  {
    key: "flux-dev",
    label: "Flux Dev",
    model: "black-forest-labs/flux-dev",
    tier: "$$",
    note: "balanced quality/cost",
  },
  {
    key: "flux-1.1-pro",
    label: "Flux 1.1 Pro",
    model: "black-forest-labs/flux-1.1-pro",
    tier: "$$$",
    note: "premium photoreal",
  },
  {
    key: "sd-3.5-large",
    label: "Stable Diffusion 3.5 Large",
    model: "stability-ai/stable-diffusion-3.5-large",
    tier: "$$",
  },
  {
    key: "ideogram-v2",
    label: "Ideogram v2",
    model: "ideogram-ai/ideogram-v2",
    tier: "$$",
    note: "crisp text & graphics",
  },
  {
    key: "recraft-v3",
    label: "Recraft V3",
    model: "recraft-ai/recraft-v3",
    tier: "$$",
    note: "clean vector/brand graphics — good for infographic covers",
  },
  {
    key: "nano-banana-pro",
    label: "Nano Banana Pro (Gemini 3 Pro Image)",
    model: "google/nano-banana-pro",
    tier: "$$$",
    note: "latest, highest-fidelity Gemini image model; best text rendering & on-brand editorial infographics; QOTD brand background",
  },
];

export const VIDEO_MODELS: MediaModelOption[] = [
  {
    key: "minimax-video-01",
    label: "Minimax Video-01",
    model: "minimax/video-01",
    tier: "$",
    note: "current Replicate default",
  },
  {
    key: "minimax-hailuo-02",
    label: "Minimax Hailuo 02",
    model: "minimax/hailuo-02",
    tier: "$$",
    note: "higher-fidelity image-to-video",
  },
  {
    key: "kling-v1.6-pro",
    label: "Kling v1.6 Pro",
    model: "kwaivgi/kling-v1.6-pro",
    tier: "$$$",
    note: "strong motion/physics",
  },
  {
    key: "luma-ray-2",
    label: "Luma Ray 2",
    model: "luma/ray-2-720p",
    tier: "$$$",
    note: "cinematic motion",
  },
  {
    key: "seedance-1-pro",
    label: "Seedance 1 Pro",
    model: "bytedance/seedance-1-pro",
    tier: "$$$",
    note: "ByteDance, premium",
  },
  {
    key: "veo-3",
    label: "Google Veo 3",
    model: "google/veo-3",
    tier: "$$$",
    note: "state of the art, highest cost",
  },
];

export function findImageModel(key: string): MediaModelOption | undefined {
  return IMAGE_MODELS.find((m) => m.key === key);
}

export function findVideoModel(key: string): MediaModelOption | undefined {
  return VIDEO_MODELS.find((m) => m.key === key);
}

/** Replicate model ids look like "owner/model" or "owner/model:version". */
const CUSTOM_MODEL_RE = /^[\w.-]+\/[\w.-]+(:[\w.-]+)?$/;

export function isValidCustomModel(value: string): boolean {
  return CUSTOM_MODEL_RE.test(value.trim());
}

export type ModelSelectionResult = { ok: true; model?: string } | { ok: false; error: string };

/**
 * Resolve a dashboard model selection to the literal Replicate model id, or an
 * error if the input is malformed. `key` is "auto"/undefined (no override),
 * a catalog key (resolved via `findImageModel`/`findVideoModel`), or "custom"
 * (in which case `custom` must hold a valid "owner/model[:version]" string).
 */
export function resolveModelSelection(
  kind: "image" | "video",
  key: string | undefined,
  custom: string | undefined,
): ModelSelectionResult {
  if (!key || key === "auto") return { ok: true, model: undefined };
  if (key === "custom") {
    const trimmed = (custom ?? "").trim();
    if (!trimmed) return { ok: false, error: "custom model id is required when key is \"custom\"" };
    if (!isValidCustomModel(trimmed)) {
      return { ok: false, error: 'custom model id must look like "owner/model" or "owner/model:version"' };
    }
    return { ok: true, model: trimmed };
  }
  const found = kind === "image" ? findImageModel(key) : findVideoModel(key);
  if (!found) return { ok: false, error: `unknown ${kind} model key: "${key}"` };
  return { ok: true, model: found.model };
}
