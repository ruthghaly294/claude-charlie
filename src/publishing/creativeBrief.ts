import { z } from "zod";
import type { Exemplar } from "@/research/exemplars";
import type { OperatorProfile } from "@/discovery/config";
import { UsageMeter } from "@/discovery/usage";
import { resolvePrompt } from "./prompts";
import { makeOpenRouterClient, hasOpenRouterKeys, DEFAULT_VOICE, type PostGenClient } from "./postGenerator";
import { extractJson } from "@/lib/extractJson";

/** Chat-completions seam (shared with postGenerator); tests inject a fake. */
export type BriefGenClient = PostGenClient;

export type Shot = { description: string; durationSec: number };

/**
 * The "imitate-then-innovate" creative brief: a vertical short-form plan that
 * mirrors the structure of trending exemplars but executes a fresh, on-brand
 * take. Drives the cover-image prompt, the seedance video prompt, and the post.
 */
export type CreativeBrief = {
  topic: string;
  hook: string;
  shotList: Shot[];
  aspectRatio: string;
  durationSec: number;
  onScreenText: string[];
  caption: string;
  hashtags: string[];
  soundMood: string;
  coverImagePrompt: string;
  videoPrompt: string;
};

export type BuildBriefInput = {
  topic: string;
  exemplars: Exemplar[];
  /** preferred sound mood (from the music layer); guides soundMood + pacing. */
  soundMood?: string;
  /** distilled NotebookLM insight (the "outsourced research" angle) to ground the innovate step. */
  notebookInsight?: string;
  /** operator-pasted research (notes, article text, transcript) to ground the post in real facts. */
  manualResearch?: string;
};

export interface BriefBuilder {
  build(input: BuildBriefInput): CreativeBrief | Promise<CreativeBrief>;
  /** the {system, user} prompt build() would send for `input` (no network call). */
  describePrompt?(input: BuildBriefInput): { system: string; user: string };
}

export type BriefBuilderOptions = {
  client: BriefGenClient;
  model?: string;
  aspectRatio?: string;
  voice?: string;
  businessName?: string;
  businessDescription?: string;
  profile?: OperatorProfile;
  meter?: UsageMeter;
  /** DB-backed prompt template overrides (see src/publishing/prompts.ts); falls back to built-in defaults. */
  promptOverrides?: Record<string, string>;
};

const DEFAULT_MODEL = "deepseek/deepseek-v4-pro";
const DEFAULT_ASPECT_RATIO = "9:16";

const shotSchema = z.object({ description: z.string().min(1), durationSec: z.number().positive() });
const briefSchema = z.object({
  hook: z.string().min(1),
  shotList: z.array(shotSchema).min(1),
  onScreenText: z.array(z.string()),
  caption: z.string().min(1),
  hashtags: z.array(z.string()),
  soundMood: z.string(),
  coverImagePrompt: z.string().min(1),
  videoPrompt: z.string().min(1),
});

function voiceContext(opts: BriefBuilderOptions): string {
  const parts: string[] = [];
  parts.push(`Voice — write the script/hook/caption in this voice:\n${opts.voice?.trim() || DEFAULT_VOICE}`);
  const biz = [opts.businessName?.trim(), opts.businessDescription?.trim()].filter(Boolean).join(" — ");
  if (biz) parts.push(`Operator: ${biz}`);
  const p = opts.profile;
  if (p) {
    const bits: string[] = [];
    if (p.audience) bits.push(`Audience: ${p.audience}.`);
    if (p.goals.length) bits.push(`Goals: ${p.goals.join("; ")}.`);
    if (bits.length) parts.push(bits.join(" "));
  }
  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

function exemplarsBlock(exemplars: Exemplar[]): string {
  if (exemplars.length === 0) return "(no exemplars found — design a strong generic short-form pattern)";
  return exemplars
    .map(
      (e, i) =>
        `${i + 1}. hook=${e.hookType}; format=${e.format}; visual=${e.visualStyle}; ` +
        `pacing=${e.pacing}; text=${e.onScreenTextStyle}; cta=${e.cta}; sound=${e.soundMood}`,
    )
    .join("\n");
}

function totalDuration(shots: Shot[]): number {
  return Math.round(shots.reduce((sum, s) => sum + s.durationSec, 0));
}

function buildPrompt(opts: BriefBuilderOptions, input: BuildBriefInput): { system: string; user: string } {
  const { topic, exemplars, soundMood, notebookInsight, manualResearch } = input;
  const user = [
    `Topic: ${topic}`,
    "",
    "Trending patterns to imitate (most successful first):",
    exemplarsBlock(exemplars),
    soundMood ? `\nPreferred sound mood: ${soundMood}` : "",
    notebookInsight
      ? [
          "\nResearched insight from the source notebook — this is the FACTUAL PAYLOAD of the post.",
          "It must land IN the caption itself, not merely be hinted at:",
          notebookInsight,
          "\nHard requirements for the caption (these override the exemplar style):",
          "- State the specific finding in plain words in the FIRST sentence: name the entity and the",
          "  concrete fact — a number, a named sign/finding, or the mechanism. Someone who reads ONLY",
          "  the caption must come away knowing the actual fact.",
          "- BANNED: curiosity-gap teases that withhold the fact — e.g. \"nobody tells you…\", \"the finding",
          "  that…\", \"the secret…\", \"here's why…\", \"reveals its true identity\". Reveal it instead.",
          "- Include at least one concrete specific from the insight (a number, a named sign, or a mechanism).",
          "- Keep it concise: 1–2 sentences. Put a key fact/number in at least one on-screen text beat too.",
          "- Stay accurate to the insight; never invent facts it does not support.",
        ].join("\n")
      : "",
    manualResearch
      ? [
          "\nOperator-provided research — treat as a trusted factual payload for the post:",
          manualResearch,
          "\nGround the hook, caption, and at least one on-screen beat in a concrete specific from this",
          "research (a number, name, or mechanism). Stay accurate to it; never invent facts beyond it.",
        ].join("\n")
      : "",
    "",
    "Produce a 6–15 second vertical short: a 3–5 shot plan (each shot with a durationSec),",
    "a scroll-stopping hook, on-screen text beats, a caption, hashtags, the soundMood,",
    "a coverImagePrompt (first frame, no rendered words), and a videoPrompt for an AI video",
    "generator describing motion, transitions, and the vertical mobile framing.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const system = resolvePrompt("brief.system", { voiceContext: voiceContext(opts) }, opts.promptOverrides);
  return { system, user };
}

export function makeOpenRouterBriefBuilder(opts: BriefBuilderOptions): BriefBuilder {
  const model = opts.model ?? DEFAULT_MODEL;
  const aspectRatio = opts.aspectRatio ?? DEFAULT_ASPECT_RATIO;

  return {
    async build(input) {
      const { topic } = input;
      const prompt = buildPrompt(opts, input);

      const res = await opts.client.complete({
        model,
        response_format: {
          type: "json_schema",
          json_schema: { name: "creative_brief", strict: true, schema: z.toJSONSchema(briefSchema) },
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

      const parsed = briefSchema.parse(extractJson(res.content));
      return {
        topic,
        ...parsed,
        aspectRatio,
        durationSec: totalDuration(parsed.shotList),
      };
    },
    describePrompt(input) {
      return buildPrompt(opts, input);
    },
  };
}

/** No-network fallback: a serviceable short-form brief from the top exemplar. */
export const deterministicBriefBuilder: BriefBuilder = {
  build({ topic, exemplars }) {
    const top = exemplars[0];
    const soundMood = top?.soundMood ?? "upbeat";
    const shotList: Shot[] = [
      { description: `Hook: bold claim about ${topic}`, durationSec: 2 },
      { description: `Payoff montage showing ${topic} in action`, durationSec: 4 },
      { description: `CTA: ${top?.cta ?? "follow for more"}`, durationSec: 2 },
    ];
    const tag = topic.replace(/[^a-z0-9]+/gi, "");
    return {
      topic,
      hook: `The truth about ${topic} nobody tells you`,
      shotList,
      aspectRatio: DEFAULT_ASPECT_RATIO,
      durationSec: totalDuration(shotList),
      onScreenText: [topic, "watch this", "save it"],
      caption: `Quick take on ${topic}.`,
      hashtags: tag ? [tag] : [],
      soundMood,
      coverImagePrompt: `A clean, high-contrast vertical cover frame about "${topic}", mobile-first, no text.`,
      videoPrompt: `Fast-cut vertical (9:16) short about ${topic}: punchy zoom transitions, ${
        top?.pacing ?? "rapid cuts"
      }, bright modern framing, ${soundMood} energy.`,
    };
  },
};

/** OpenRouter/DeepSeek when a key is present, else the deterministic fallback. */
export function getBriefBuilder(
  config: {
    model?: string;
    aspectRatio?: string;
    voice?: string;
    businessName?: string;
    businessDescription?: string;
    profile?: OperatorProfile;
    promptOverrides?: Record<string, string>;
  } = {},
  env: Record<string, string | undefined> = process.env,
  meter?: UsageMeter,
): BriefBuilder {
  if (!hasOpenRouterKeys(env) || env.DECODE_REASONER === "deterministic") {
    return deterministicBriefBuilder;
  }
  return makeOpenRouterBriefBuilder({
    client: makeOpenRouterClient(env),
    model: config.model ?? env.OPENROUTER_MODEL,
    aspectRatio: config.aspectRatio,
    voice: config.voice,
    businessName: config.businessName,
    businessDescription: config.businessDescription,
    profile: config.profile,
    promptOverrides: config.promptOverrides,
    meter,
  });
}
