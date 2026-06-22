import { z } from "zod";
import { UsageMeter } from "@/discovery/usage";
import { makeOpenRouterClient, hasOpenRouterKeys, type PostGenClient } from "./postGenerator";
import { extractJson } from "@/lib/extractJson";
import type { CreativeBrief } from "./creativeBrief";

/**
 * Scores a candidate cover frame as a sound-off thumbnail (0-100) so the
 * pipeline can render several covers and animate only the strongest — the
 * frame everything downstream (the video) is built on. Vision-backed: sends the
 * image to a multimodal model. Degrades to a no-op scorer without a key, in
 * which case best-of-N falls back to the first cover.
 */
export interface CoverScorer {
  score(imageUrl: string, brief: CreativeBrief): Promise<number>;
}

export type CoverScorerOptions = {
  client: PostGenClient;
  model?: string;
  meter?: UsageMeter;
};

const DEFAULT_MODEL = "openai/gpt-4o-mini";

const scoreSchema = z.object({
  score: z.number(),
  thumbStop: z.number(),
  clarity: z.number(),
  rationale: z.string(),
});

const SYSTEM = `You are a short-form thumbnail analyst. Given a candidate vertical 9:16 cover frame and the video's plan, rate how well it works as a scroll-stopping, sound-off first frame (0-100, 100 = near-certain thumb-stop). Judge:
- thumbStop (0-100): does it stop the scroll at a glance on a small phone screen (contrast, single clear subject, implied tension)?
- clarity (0-100): is the subject clean, in-frame, uncluttered, and free of warped artifacts/garbled text?
Reserve 80+ for genuinely strong frames. Return strict JSON.`;

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function makeOpenRouterCoverScorer(opts: CoverScorerOptions): CoverScorer {
  const model = opts.model ?? DEFAULT_MODEL;
  return {
    async score(imageUrl, brief) {
      const res = await opts.client.complete({
        model,
        response_format: {
          type: "json_schema",
          json_schema: { name: "cover_score", strict: true, schema: z.toJSONSchema(scoreSchema) },
        },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: `topic: ${brief.topic}\nhook: ${brief.hook}` },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      });
      if (opts.meter && res.usage) {
        opts.meter.record(model, {
          inputTokens: res.usage.prompt_tokens ?? 0,
          outputTokens: res.usage.completion_tokens ?? 0,
        });
      }
      const parsed = scoreSchema.parse(extractJson(res.content));
      return clamp(parsed.score);
    },
  };
}

/**
 * Vision cover scorer, or undefined when no OpenRouter key (or deterministic
 * mode) — callers treat undefined as "render a single cover".
 */
export function getCoverScorer(
  env: Record<string, string | undefined> = process.env,
  meter?: UsageMeter,
): CoverScorer | undefined {
  // Requires an explicit vision-capable model — the base OPENROUTER_MODEL
  // (e.g. owl-alpha) 404s with "no endpoints that support image input", so
  // without OPENROUTER_VISION_MODEL best-of-N just keeps the first cover.
  if (!hasOpenRouterKeys(env) || env.DECODE_REASONER === "deterministic" || !env.OPENROUTER_VISION_MODEL) {
    return undefined;
  }
  return makeOpenRouterCoverScorer({
    client: makeOpenRouterClient(env),
    model: env.OPENROUTER_VISION_MODEL,
    meter,
  });
}
