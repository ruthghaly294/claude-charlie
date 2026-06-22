import { z } from "zod";
import type { Exemplar } from "@/research/exemplars";
import { UsageMeter } from "@/discovery/usage";
import { makeOpenRouterClient, hasOpenRouterKeys, type PostGenClient } from "./postGenerator";
import { extractJson } from "@/lib/extractJson";
import type { CreativeBrief } from "./creativeBrief";
import type { ViralityReport } from "./viralityScore";

/**
 * A text-model stand-in for Higgsfield's Virality Predictor: instead of watching
 * the rendered clip (which needs a paid vision model), owl-alpha scores the PLAN
 * — hook, caption, on-screen text, pacing — and returns the same `ViralityReport`
 * shape so it drops straight into the existing gate. This lets the virality gate
 * work on the free path.
 */
export type BriefViralityInput = {
  brief: CreativeBrief;
  exemplars?: Exemplar[];
};

export interface BriefViralityScorer {
  score(input: BriefViralityInput): Promise<ViralityReport>;
}

export type BriefViralityScorerOptions = {
  client: PostGenClient;
  model?: string;
  meter?: UsageMeter;
};

const DEFAULT_MODEL = "deepseek/deepseek-v4-pro";

const breakdownSchema = z.object({
  score: z.number(),
  hookStrength: z.number(),
  retentionRisk: z.number(),
  captionLandsFact: z.boolean(),
  rationale: z.string(),
});

const SYSTEM = `You are a short-form virality analyst. Given a planned vertical video (hook, shot list, on-screen text, caption, sound mood), predict its attention performance. Score 0-100 where 100 = near-certain breakout. Judge:
- hookStrength (0-100): does the first 1-2s stop the scroll?
- retentionRisk (0-100, higher = worse): how likely viewers drop before payoff?
- captionLandsFact (boolean): does the caption STATE a concrete fact/number in its first sentence (not a curiosity-gap tease)?
Be decisive and calibrated; reserve 80+ for genuinely strong hooks. Return strict JSON.`;

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function buildUser(input: BriefViralityInput): string {
  const { brief } = input;
  return [
    `topic: ${brief.topic}`,
    `hook: ${brief.hook}`,
    `shots: ${brief.shotList.map((s) => `${s.durationSec}s ${s.description}`).join(" | ")}`,
    `onScreenText: ${brief.onScreenText.join(" / ")}`,
    `caption: ${brief.caption}`,
    `sound: ${brief.soundMood}`,
  ].join("\n");
}

export function makeOpenRouterBriefViralityScorer(
  opts: BriefViralityScorerOptions,
): BriefViralityScorer {
  const model = opts.model ?? DEFAULT_MODEL;
  return {
    async score(input) {
      const res = await opts.client.complete({
        model,
        response_format: {
          type: "json_schema",
          json_schema: { name: "virality_breakdown", strict: true, schema: z.toJSONSchema(breakdownSchema) },
        },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: buildUser(input) },
        ],
      });
      if (opts.meter && res.usage) {
        opts.meter.record(model, {
          inputTokens: res.usage.prompt_tokens ?? 0,
          outputTokens: res.usage.completion_tokens ?? 0,
        });
      }
      const parsed = breakdownSchema.parse(extractJson(res.content));
      return {
        score: clamp(parsed.score),
        reportUrl: null,
        raw: JSON.stringify({ ...parsed, score: clamp(parsed.score), scorer: "llm" }),
      };
    },
  };
}

/** No-network fallback: unknown score ⇒ the gate routes to draft (safe default). */
export const deterministicBriefViralityScorer: BriefViralityScorer = {
  score: async () => ({ score: null, reportUrl: null, raw: "(virality scoring unavailable)" }),
};

export function getBriefViralityScorer(
  env: Record<string, string | undefined> = process.env,
  meter?: UsageMeter,
): BriefViralityScorer {
  if (!hasOpenRouterKeys(env) || env.DECODE_REASONER === "deterministic") {
    return deterministicBriefViralityScorer;
  }
  return makeOpenRouterBriefViralityScorer({
    client: makeOpenRouterClient(env),
    model: env.OPENROUTER_MODEL,
    meter,
  });
}
