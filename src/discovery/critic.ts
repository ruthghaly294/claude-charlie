import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ReasonerClient } from "./claudeReasoner";
import { UsageMeter } from "./usage";
import { makeOpenRouterClient, hasOpenRouterKeys, type PostGenClient } from "@/publishing/postGenerator";
import { extractJson } from "@/lib/extractJson";

export type DraftInput = { title: string; body: string; lane: string };
export type DraftReview = { score: number; notes: string };

/**
 * The quality gate. Scores a drafted asset 1–5 so only sellable drafts get
 * promoted to "ready". Same async seam as Reasoner: deterministic by default,
 * Claude-backed when a key is present.
 */
export interface Critic {
  scoreDraft(input: DraftInput): DraftReview | Promise<DraftReview>;
}

/** No-LLM fallback: a neutral pass so deterministic runs still produce products. */
export const neutralCritic: Critic = {
  scoreDraft: () => ({ score: 4, notes: "ungraded (deterministic critic)" }),
};

const reviewSchema = z.object({
  sellability: z.number(),
  specificity: z.number(),
  novelty: z.number(),
  actionability: z.number(),
  notes: z.string(),
});

const SYSTEM = `You are a ruthless editor for a paid research/newsletter business. Score a draft on whether a buyer would actually pay for it. Be harsh: generic, vague, or obvious drafts score low. Each criterion is 1 (worthless) to 5 (premium).`;

export function makeClaudeCritic(opts: {
  client: ReasonerClient;
  model?: string;
  meter?: UsageMeter;
}): Critic {
  const model = opts.model ?? "claude-opus-4-8";
  return {
    async scoreDraft(input: DraftInput): Promise<DraftReview> {
      const res = await opts.client.messages.parse({
        model,
        max_tokens: 1500,
        thinking: { type: "adaptive" },
        output_config: { format: zodOutputFormat(reviewSchema), effort: "high" },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `Lane: ${input.lane}\nTitle: ${input.title}\n\n${input.body}\n\nScore sellability, specificity, novelty, actionability (1–5 each) and give one line of notes.`,
          },
        ],
      });
      if (opts.meter && res.usage) {
        opts.meter.record(model, {
          inputTokens: res.usage.input_tokens ?? 0,
          outputTokens: res.usage.output_tokens ?? 0,
        });
      }
      return aggregate(reviewSchema.parse(res.parsed_output));
    },
  };
}

function aggregate(r: z.infer<typeof reviewSchema>): DraftReview {
  const score =
    Math.round(((r.sellability + r.specificity + r.novelty + r.actionability) / 4) * 100) / 100;
  return { score, notes: r.notes };
}

/** OpenRouter/DeepSeek-backed critic: same rubric over the chat-completions seam. */
export function makeOpenRouterCritic(opts: {
  client: PostGenClient;
  model?: string;
  meter?: UsageMeter;
}): Critic {
  const model = opts.model ?? "deepseek/deepseek-v4-pro";
  return {
    async scoreDraft(input: DraftInput): Promise<DraftReview> {
      const res = await opts.client.complete({
        model,
        max_tokens: 1500,
        response_format: {
          type: "json_schema",
          json_schema: { name: "review", strict: true, schema: z.toJSONSchema(reviewSchema) },
        },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Lane: ${input.lane}\nTitle: ${input.title}\n\n${input.body}\n\nScore sellability, specificity, novelty, actionability (1–5 each) and give one line of notes.`,
          },
        ],
      });
      if (opts.meter && res.usage) {
        opts.meter.record(model, {
          inputTokens: res.usage.prompt_tokens ?? 0,
          outputTokens: res.usage.completion_tokens ?? 0,
        });
      }
      return aggregate(reviewSchema.parse(extractJson(res.content)));
    },
  };
}

/**
 * Select the critic: OpenRouter/DeepSeek when OPENROUTER_API_KEY is set, else
 * Claude when ANTHROPIC_API_KEY is set, else the neutral fallback.
 */
export function getCritic(
  env: Record<string, string | undefined> = process.env,
  meter?: UsageMeter,
): Critic {
  if (env.DECODE_REASONER === "deterministic") return neutralCritic;
  if (hasOpenRouterKeys(env)) {
    return makeOpenRouterCritic({
      client: makeOpenRouterClient(env),
      model: env.DECODE_MODEL ?? env.OPENROUTER_MODEL,
      meter,
    });
  }
  if (env.ANTHROPIC_API_KEY) {
    return makeClaudeCritic({
      client: new Anthropic() as unknown as ReasonerClient,
      model: env.DECODE_MODEL,
      meter,
    });
  }
  return neutralCritic;
}
