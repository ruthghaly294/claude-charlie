import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Signal, Insight, Decision } from "@/db/schema";
import type { Lane, OperatorProfile } from "./config";
import {
  deterministicReasoner,
  type Reasoner,
  type ClusterSummary,
  type DecisionProposal,
  type AssetDraft,
} from "./reasoner";
import { UsageMeter } from "./usage";
import { makeOpenRouterClient, hasOpenRouterKeys, type PostGenClient } from "@/publishing/postGenerator";
import { extractJson } from "@/lib/extractJson";

/** A backend-agnostic structured ask: returns schema-validated JSON. */
type Ask = <T>(schema: z.ZodType<T>, instruction: string, maxTokens: number) => Promise<T>;

/**
 * Minimal structural view of the Anthropic client we depend on. Keeping it tiny
 * lets tests inject a fake without pulling in the SDK's full type surface.
 */
export interface ReasonerClient {
  messages: {
    parse: (body: Record<string, unknown>) => Promise<{
      parsed_output: unknown;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>;
  };
}

export type ClaudeReasonerOptions = {
  client: ReasonerClient;
  model?: string;
  businessName?: string;
  businessDescription?: string;
  profile?: OperatorProfile;
  /** records token usage + cost across calls (for the run's cost ledger) */
  meter?: UsageMeter;
};

const importance = z.enum(["high", "medium", "low"]);

const insightSchema = z.object({
  trend: z.string(),
  importance,
  whatChanged: z.string(),
  whyItMatters: z.string(),
  monetizableAngle: z.string(),
});

const decisionSchema = z.object({
  title: z.string(),
  effort: z.enum(["high", "medium", "low"]),
  confidence: z.enum(["high", "medium", "low"]),
  valuePerMonth: z.number(),
  rationale: z.string(),
  monetization: z.string(),
});

const assetSchema = z.object({
  title: z.string(),
  body: z.string(),
});

const SYSTEM = `You are a market-intelligence analyst for a solo operator who monetizes insight by selling digital products — premium newsletters, research briefs, dashboards, and short courses. Every output must be concrete, specific, and immediately actionable toward a sellable digital product. No filler, no hedging, no generic advice.`;

type ReasonerContext = {
  businessName?: string;
  businessDescription?: string;
  profile?: OperatorProfile;
};

function biz(opts: ReasonerContext): string {
  const parts: string[] = [];
  const name = opts.businessName?.trim();
  const desc = opts.businessDescription?.trim();
  if (name || desc) parts.push([name, desc].filter(Boolean).join(" — "));

  const p = opts.profile;
  if (p) {
    if (p.goals.length) parts.push(`Goals: ${p.goals.join("; ")}.`);
    if (p.weeklyHours) parts.push(`Available: ~${p.weeklyHours} hrs/week.`);
    if (p.skills.length) parts.push(`Skills: ${p.skills.join(", ")}.`);
    if (p.risk) parts.push(`Risk appetite: ${p.risk}.`);
    if (p.monetizationTarget) parts.push(`Revenue target: ${p.monetizationTarget}.`);
    if (p.audience) parts.push(`Audience: ${p.audience}.`);
  }
  if (parts.length === 0) return "";
  return `\n\nOperator context — tailor everything to this person:\n${parts.join("\n")}`;
}

/**
 * The Reasoner's three methods, built once over a backend-agnostic `ask`. Both
 * the Claude and OpenRouter/DeepSeek factories below share this — only the
 * transport differs.
 */
function buildReasoner(ask: Ask): Reasoner {
  return {
    async summarizeCluster(
      cluster: string,
      signals: Signal[],
    ): Promise<ClusterSummary> {
      const evidence = signals
        .slice(0, 12)
        .map((s) => `- ${s.title}${s.raw ? ` — ${s.raw.slice(0, 200)}` : ""}`)
        .join("\n");
      const out = await ask(
        insightSchema,
        `Cluster "${cluster}" has ${signals.length} signal(s):\n${evidence}\n\nDistill ONE sharp insight: the trend (a punchy one-line headline), its importance, what changed, why it matters, and the single best way to monetize it as a digital product.`,
        4000,
      );
      const body = [
        `**What changed:** ${out.whatChanged}`,
        `**Why it matters:** ${out.whyItMatters}`,
        `**Monetizable angle:** ${out.monetizableAngle}`,
      ].join("\n");
      return { trend: out.trend, body, importance: out.importance };
    },

    async proposeDecision(
      insight: Insight,
      lane: Lane,
    ): Promise<DecisionProposal> {
      const out = await ask(
        decisionSchema,
        `Insight: "${insight.trend}" (importance: ${insight.importance}).\n${insight.body}\n\nLane: ${lane}. Propose ONE concrete, monetizable digital-product decision for this lane: an imperative title, the effort (high/medium/low), your confidence it will sell (high/medium/low), a realistic expected revenue per month in dollars (valuePerMonth), the rationale, and exactly how it makes money.`,
        2000,
      );
      return {
        title: out.title,
        effort: out.effort,
        confidence: out.confidence,
        valuePerMonth: out.valuePerMonth,
        rationale: `${out.rationale}\n\nMonetization: ${out.monetization}`,
      };
    },

    async draftAsset(decision: Decision): Promise<AssetDraft> {
      const out = await ask(
        assetSchema,
        `Decision: "${decision.title}" (lane: ${decision.lane}).\nRationale: ${decision.rationale}\n\nDraft the actual sellable digital asset in ready-to-publish Markdown — something a buyer would pay for (a research brief, newsletter issue, or product outline as fits the lane). Be specific and complete.`,
        8000,
      );
      return { title: out.title, body: out.body };
    },
  };
}

/**
 * A Claude-backed Reasoner (Anthropic SDK behind the ReasonerClient seam). Tests
 * pass a fake client.
 */
export function makeClaudeReasoner(opts: ClaudeReasonerOptions): Reasoner {
  const model = opts.model ?? "claude-opus-4-8";
  const ask: Ask = async (schema, instruction, maxTokens) => {
    const res = await opts.client.messages.parse({
      model,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(schema), effort: "high" },
      system: SYSTEM + biz(opts),
      messages: [{ role: "user", content: instruction }],
    });
    if (opts.meter && res.usage) {
      opts.meter.record(model, {
        inputTokens: res.usage.input_tokens ?? 0,
        outputTokens: res.usage.output_tokens ?? 0,
      });
    }
    return schema.parse(res.parsed_output);
  };
  return buildReasoner(ask);
}

export type OpenRouterReasonerOptions = ReasonerContext & {
  client: PostGenClient;
  model?: string;
  meter?: UsageMeter;
};

/**
 * An OpenRouter/DeepSeek-backed Reasoner: same prompts/schemas as the Claude
 * path, over the OpenAI-compatible chat-completions seam (json_schema output).
 */
export function makeOpenRouterReasoner(opts: OpenRouterReasonerOptions): Reasoner {
  const model = opts.model ?? "deepseek/deepseek-v4-pro";
  const ask: Ask = async (schema, instruction, maxTokens) => {
    const res = await opts.client.complete({
      model,
      max_tokens: maxTokens,
      response_format: {
        type: "json_schema",
        json_schema: { name: "result", strict: true, schema: z.toJSONSchema(schema) },
      },
      messages: [
        { role: "system", content: SYSTEM + biz(opts) },
        { role: "user", content: instruction },
      ],
    });
    if (opts.meter && res.usage) {
      opts.meter.record(model, {
        inputTokens: res.usage.prompt_tokens ?? 0,
        outputTokens: res.usage.completion_tokens ?? 0,
      });
    }
    return schema.parse(extractJson(res.content));
  };
  return buildReasoner(ask);
}

/**
 * Select the reasoner for a run: OpenRouter/DeepSeek when OPENROUTER_API_KEY is
 * set, else Claude when ANTHROPIC_API_KEY is set, else the deterministic
 * fallback. Set DECODE_REASONER=deterministic to force the fallback.
 */
export function getReasoner(
  config: ReasonerContext = {},
  env: Record<string, string | undefined> = process.env,
  meter?: UsageMeter,
): Reasoner {
  if (env.DECODE_REASONER === "deterministic") return deterministicReasoner;
  if (hasOpenRouterKeys(env)) {
    return makeOpenRouterReasoner({
      client: makeOpenRouterClient(env),
      model: env.DECODE_MODEL ?? env.OPENROUTER_MODEL,
      businessName: config.businessName,
      businessDescription: config.businessDescription,
      profile: config.profile,
      meter,
    });
  }
  if (env.ANTHROPIC_API_KEY) {
    return makeClaudeReasoner({
      client: new Anthropic() as unknown as ReasonerClient,
      model: env.DECODE_MODEL,
      businessName: config.businessName,
      businessDescription: config.businessDescription,
      profile: config.profile,
      meter,
    });
  }
  return deterministicReasoner;
}
