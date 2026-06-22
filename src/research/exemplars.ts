import { z } from "zod";
import { makeOpenRouterClient, hasOpenRouterKeys, type PostGenClient } from "@/publishing/postGenerator";
import { resolvePrompt } from "@/publishing/prompts";
import { UsageMeter } from "@/discovery/usage";
import { extractJson } from "@/lib/extractJson";
import type { RankedReport, RankedItem } from "./rank";

/** The chat-completions seam (shared with postGenerator); tests inject a fake. */
export type ExemplarExtractClient = PostGenClient;

/** Asset shapes a trending exemplar can take. */
export const EXEMPLAR_FORMATS = ["reel", "video", "carousel", "image", "thread"] as const;
export type ExemplarFormat = (typeof EXEMPLAR_FORMATS)[number];

/**
 * A structured read of *why a top-performing piece worked* — the pattern we
 * later imitate (Phase 3) then innovate on. Derived from a ranked research pick.
 */
export type Exemplar = {
  source: string;
  sourceUrl: string;
  title: string;
  rankScore: number;
  hookType: string;
  format: ExemplarFormat;
  visualStyle: string;
  pacing: string;
  onScreenTextStyle: string;
  cta: string;
  soundMood: string;
  /** thumbnail of the original (when captured), so the UI can show what was imitated. */
  imageUrl?: string;
};

export interface ExemplarExtractor {
  extract(report: RankedReport): Exemplar[] | Promise<Exemplar[]>;
  /** the {system, user} prompt extract() would send for `report` (no network call). */
  describePrompt?(report: RankedReport): { system: string; user: string } | null;
}

export type ExemplarExtractorOptions = {
  client: ExemplarExtractClient;
  model?: string;
  /** how many top picks to analyse */
  topN?: number;
  meter?: UsageMeter;
  /** DB-backed prompt template overrides (see src/publishing/prompts.ts); falls back to built-in defaults. */
  promptOverrides?: Record<string, string>;
  /** send pick thumbnails to a vision model so it analyses what's on screen, not just the title. */
  vision?: boolean;
  /** vision-capable model for image analysis (the base `model` — e.g. owl-alpha — may be text-only). */
  visionModel?: string;
};

const DEFAULT_MODEL = "deepseek/deepseek-v4-pro";
const DEFAULT_TOP_N = 5;

const patternSchema = z.object({
  hookType: z.string(),
  format: z.enum(EXEMPLAR_FORMATS),
  visualStyle: z.string(),
  pacing: z.string(),
  onScreenTextStyle: z.string(),
  cta: z.string(),
  soundMood: z.string(),
});
const responseSchema = z.object({ exemplars: z.array(patternSchema) });

function engagementSum(item: RankedItem): number {
  return Object.values(item.engagement).reduce((sum, n) => sum + n, 0);
}

/** Heuristic format guess from the source platform, used by the offline fallback. */
function formatForSource(source: string): ExemplarFormat {
  const s = source.toLowerCase();
  if (s.includes("tiktok") || s.includes("youtube") || s.includes("instagram")) return "reel";
  if (s.includes("reddit") || s.includes("hackernews") || s.includes("hn")) return "thread";
  return "image";
}

function attach(picks: RankedItem[], patterns: z.infer<typeof patternSchema>[]): Exemplar[] {
  return picks.map((p, i) => {
    const pat = patterns[i];
    return {
      source: p.source,
      sourceUrl: p.url,
      title: p.title,
      rankScore: p.score,
      hookType: pat?.hookType ?? "curiosity hook",
      format: pat?.format ?? formatForSource(p.source),
      visualStyle: pat?.visualStyle ?? "clean, high-contrast, mobile-first",
      pacing: pat?.pacing ?? "fast cuts",
      onScreenTextStyle: pat?.onScreenTextStyle ?? "bold captions",
      cta: pat?.cta ?? "follow for more",
      soundMood: pat?.soundMood ?? "upbeat",
      ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}),
    };
  });
}

/**
 * Build the user message content. With `vision` and pick thumbnails available,
 * returns a multimodal content array (text + image_url parts) so a vision model
 * analyses the actual frames; otherwise a plain string.
 */
function buildUserContent(
  report: RankedReport,
  topN: number,
  vision: boolean,
): string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> {
  const text = buildPrompt(report, topN)?.user ?? "";
  const picks = report.topPicks.slice(0, topN);
  const images = picks.filter((p) => p.imageUrl);
  if (!vision || images.length === 0) return text;
  const parts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
    { type: "text", text },
  ];
  picks.forEach((p, i) => {
    if (p.imageUrl) {
      parts.push({ type: "text", text: `Image for item ${i + 1}:` });
      parts.push({ type: "image_url", image_url: { url: p.imageUrl } });
    }
  });
  return parts;
}

/**
 * LLM-backed extractor: one call returns a pattern per top pick (in order),
 * which we zip back onto the source items. Mirrors the makeOpenRouterGenerator
 * seam in postGenerator.ts.
 */
/** Build the {system, user} prompt for `report`; null when there's nothing to extract (no picks). */
function buildPrompt(
  report: RankedReport,
  topN: number,
  promptOverrides?: Record<string, string>,
): { system: string; user: string } | null {
  const picks = report.topPicks.slice(0, topN);
  if (picks.length === 0) return null;

  const itemsBlock = picks
    .map((p, i) =>
      [
        `${i + 1}. [${p.source}] ${p.title}`,
        p.snippet ? `   Snippet: ${p.snippet}` : "",
        `   Engagement: ${engagementSum(p)}`,
      ]
        .filter((l) => l !== "")
        .join("\n"),
    )
    .join("\n");

  const user = [
    `Topic: ${report.topic}`,
    "",
    "Top-performing items (most successful first):",
    itemsBlock,
    "",
    `Return an "exemplars" array with exactly one object per item, in the same order.`,
  ].join("\n");

  return { system: resolvePrompt("exemplars.system", {}, promptOverrides), user };
}

export function makeOpenRouterExemplarExtractor(
  opts: ExemplarExtractorOptions,
): ExemplarExtractor {
  const model = opts.model ?? DEFAULT_MODEL;
  const topN = opts.topN ?? DEFAULT_TOP_N;

  return {
    async extract(report) {
      const picks = report.topPicks.slice(0, topN);
      const prompt = buildPrompt(report, topN, opts.promptOverrides);
      if (!prompt) return [];

      // Vision only when a vision-capable model is configured; otherwise the base
      // model (e.g. owl-alpha) has no image endpoint and would 404. Falls back to
      // a text-only analysis either way.
      const canVision = (opts.vision ?? false) && Boolean(opts.visionModel);
      const userContent = buildUserContent(report, topN, canVision);
      const isMultimodal = Array.isArray(userContent);

      const call = (content: typeof userContent, useModel: string) =>
        opts.client.complete({
          model: useModel,
          response_format: {
            type: "json_schema",
            json_schema: { name: "exemplars", strict: true, schema: z.toJSONSchema(responseSchema) },
          },
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content },
          ],
        });

      // Vision goes to a vision-capable model; if that errors (e.g. the model has
      // no image-input endpoint, or none is configured), fall back to a text-only
      // analysis on the base model so the run never dies on enrichment.
      let usedModel = isMultimodal && opts.visionModel ? opts.visionModel : model;
      let res;
      try {
        res = await call(userContent, usedModel);
      } catch (err) {
        if (!isMultimodal) throw err;
        usedModel = model;
        res = await call(prompt.user, usedModel);
      }

      if (opts.meter && res.usage) {
        opts.meter.record(usedModel, {
          inputTokens: res.usage.prompt_tokens ?? 0,
          outputTokens: res.usage.completion_tokens ?? 0,
        });
      }

      const parsed = responseSchema.parse(extractJson(res.content));
      return attach(picks, parsed.exemplars);
    },
    describePrompt(report) {
      return buildPrompt(report, topN, opts.promptOverrides);
    },
  };
}

/** No-network fallback: derive a serviceable exemplar from each pick's metadata. */
export const deterministicExemplarExtractor: ExemplarExtractor = {
  extract(report) {
    return attach(report.topPicks.slice(0, DEFAULT_TOP_N), []);
  },
};

/**
 * Select the extractor: OpenRouter/DeepSeek when a key is present, else the
 * deterministic fallback (also forced by DECODE_REASONER=deterministic).
 */
export function getExemplarExtractor(
  config: { model?: string; topN?: number; promptOverrides?: Record<string, string>; vision?: boolean } = {},
  env: Record<string, string | undefined> = process.env,
  meter?: UsageMeter,
): ExemplarExtractor {
  if (!hasOpenRouterKeys(env) || env.DECODE_REASONER === "deterministic") {
    return deterministicExemplarExtractor;
  }
  return makeOpenRouterExemplarExtractor({
    client: makeOpenRouterClient(env),
    model: config.model ?? env.OPENROUTER_MODEL,
    visionModel: env.OPENROUTER_VISION_MODEL,
    topN: config.topN,
    promptOverrides: config.promptOverrides,
    vision: config.vision,
    meter,
  });
}
