import { z } from "zod";
import type { Exemplar } from "@/research/exemplars";
import type { OperatorProfile } from "@/discovery/config";
import { UsageMeter } from "@/discovery/usage";
import { resolvePrompt } from "./prompts";
import { makeOpenRouterClient, hasOpenRouterKeys, type PostGenClient } from "./postGenerator";
import { extractJson } from "@/lib/extractJson";
import type { CreativeBrief } from "./creativeBrief";

export type IdeaJudgeClient = PostGenClient;

/** The pre-generation verdict on a planned video, before any render spend. */
export type IdeaJudgment = {
  /** 0–100 predicted performance/fit. The orchestrator gates on this. */
  score: number;
  /** the sharpened angle the judge recommends running with. */
  angle: string;
  rationale: string;
  risks: string;
};

export type JudgeInput = {
  topic: string;
  exemplars: Exemplar[];
  brief: CreativeBrief;
};

export interface IdeaJudge {
  judge(input: JudgeInput): IdeaJudgment | Promise<IdeaJudgment>;
  /** the {system, user} prompt judge() would send for `input` (no network call). */
  describePrompt?(input: JudgeInput): { system: string; user: string };
}

export type IdeaJudgeOptions = {
  client: IdeaJudgeClient;
  model?: string;
  voice?: string;
  businessName?: string;
  businessDescription?: string;
  profile?: OperatorProfile;
  meter?: UsageMeter;
  /** DB-backed prompt template overrides (see src/publishing/prompts.ts); falls back to built-in defaults. */
  promptOverrides?: Record<string, string>;
};

const DEFAULT_MODEL = "deepseek/deepseek-v4-pro";

const judgmentSchema = z.object({
  score: z.number(),
  angle: z.string(),
  rationale: z.string(),
  risks: z.string(),
});

function context(opts: IdeaJudgeOptions): string {
  const parts: string[] = [];
  if (opts.voice?.trim()) parts.push(`Brand voice: ${opts.voice.trim()}`);
  const biz = [opts.businessName?.trim(), opts.businessDescription?.trim()].filter(Boolean).join(" — ");
  if (biz) parts.push(`Operator: ${biz}`);
  if (opts.profile?.audience) parts.push(`Audience: ${opts.profile.audience}`);
  return parts.length ? `\n\n${parts.join("\n")}` : "";
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function exemplarsBlock(exemplars: Exemplar[]): string {
  if (exemplars.length === 0) return "(no exemplars)";
  return exemplars
    .map((e, i) => `${i + 1}. hook=${e.hookType}; format=${e.format}; pacing=${e.pacing}; sound=${e.soundMood}`)
    .join("\n");
}

function buildPrompt(opts: IdeaJudgeOptions, input: JudgeInput): { system: string; user: string } {
  const { topic, exemplars, brief } = input;
  const user = [
    `Topic: ${topic}`,
    "",
    "Currently trending patterns:",
    exemplarsBlock(exemplars),
    "",
    "Planned video:",
    `hook: ${brief.hook}`,
    `shots: ${brief.shotList.map((s) => `${s.durationSec}s ${s.description}`).join(" | ")}`,
    `caption: ${brief.caption}`,
    `sound: ${brief.soundMood}`,
    "",
    "Judge whether to produce this. Return score (0–100), angle, rationale, risks.",
  ].join("\n");

  const system = resolvePrompt("judge.system", { context: context(opts) }, opts.promptOverrides);
  return { system, user };
}

export function makeOpenRouterIdeaJudge(opts: IdeaJudgeOptions): IdeaJudge {
  const model = opts.model ?? DEFAULT_MODEL;
  return {
    async judge(input) {
      const prompt = buildPrompt(opts, input);

      const res = await opts.client.complete({
        model,
        response_format: {
          type: "json_schema",
          json_schema: { name: "idea_judgment", strict: true, schema: z.toJSONSchema(judgmentSchema) },
        },
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      });

      if (opts.meter && res.usage) {
        opts.meter.record(model, {
          inputTokens: res.usage.prompt_tokens ?? 0,
          outputTokens: res.usage.completion_tokens ?? 0,
        });
      }

      const parsed = judgmentSchema.parse(extractJson(res.content));
      return { ...parsed, score: clamp(parsed.score) };
    },
    describePrompt(input) {
      return buildPrompt(opts, input);
    },
  };
}

/** No-network fallback: pass everything (score 100) so deterministic/demo runs still produce. */
export const deterministicIdeaJudge: IdeaJudge = {
  judge: ({ brief }) => ({
    score: 100,
    angle: brief.hook,
    rationale: "ungraded (deterministic judge)",
    risks: "",
  }),
};

/** OpenRouter/DeepSeek judge when a key is present, else the deterministic pass. */
export function getIdeaJudge(
  config: {
    model?: string;
    voice?: string;
    businessName?: string;
    businessDescription?: string;
    profile?: OperatorProfile;
    promptOverrides?: Record<string, string>;
  } = {},
  env: Record<string, string | undefined> = process.env,
  meter?: UsageMeter,
): IdeaJudge {
  if (!hasOpenRouterKeys(env) || env.DECODE_REASONER === "deterministic") {
    return deterministicIdeaJudge;
  }
  return makeOpenRouterIdeaJudge({
    client: makeOpenRouterClient(env),
    model: config.model ?? env.OPENROUTER_MODEL,
    voice: config.voice,
    businessName: config.businessName,
    businessDescription: config.businessDescription,
    profile: config.profile,
    promptOverrides: config.promptOverrides,
    meter,
  });
}
