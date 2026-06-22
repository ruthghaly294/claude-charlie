import { z } from "zod";
import type { ResearchItem } from "@/research/last30days";
import type { OperatorProfile } from "@/discovery/config";
import { UsageMeter } from "@/discovery/usage";
import { OpenRouterKeyPool, parseOpenRouterKeys } from "@/lib/openRouterPool";
import { extractJson } from "@/lib/extractJson";

/** Channels we tailor a post variant for, each with its own audience + style. */
export const PLATFORMS = ["x", "reddit", "instagram", "facebook"] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * Distribution targets for the trend-imitation publisher. A superset of the
 * amalgamation `Platform` that adds TikTok — kept separate so adding a publish
 * target never forces the post-amalgamation generator to synthesize an extra
 * per-platform text variant.
 */
export const PUBLISH_PLATFORMS = [...PLATFORMS, "tiktok"] as const;
export type PublishPlatform = (typeof PUBLISH_PLATFORMS)[number];

/** Max research items a single "Generate amalgamation" request may combine. */
export const MAX_AMALGAMATION_ITEMS = 5;

/** X (Twitter) post character limit. */
export const X_MAX_LENGTH = 280;

/**
 * Minimal structural view of the OpenRouter chat-completions client we depend
 * on. Keeping it tiny lets tests inject a fake; the factory below wires a real
 * `fetch`-backed client. OpenRouter is OpenAI-compatible, so `complete` maps
 * onto POST /chat/completions.
 */
export interface PostGenClient {
  complete(body: Record<string, unknown>): Promise<{
    content: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  }>;
}

export type GeneratedPost = { text: string; hashtags: string[] };
export type GeneratedPostSet = {
  variants: Record<Platform, GeneratedPost>;
  /** A prompt describing a supplemental cover-image asset (for Higgsfield). */
  assetPrompt: string;
};

export interface PostGenerator {
  generatePosts(input: {
    topic: string;
    /** Non-empty; >1 items produces one post synthesizing all of them ("amalgamation"). */
    items: ResearchItem[];
  }): GeneratedPostSet | Promise<GeneratedPostSet>;
}

export type OpenRouterGeneratorOptions = {
  client: PostGenClient;
  model?: string;
  businessName?: string;
  businessDescription?: string;
  profile?: OperatorProfile;
  /** Brand voice/persona; falls back to DEFAULT_VOICE when empty. */
  voice?: string;
  /** records token usage + cost for the post-generation call */
  meter?: UsageMeter;
};

const variantSchema = z.object({
  caption: z.string().min(1),
  hashtags: z.array(z.string()),
});
const postsSchema = z.object({
  x: variantSchema,
  reddit: variantSchema,
  instagram: variantSchema,
  facebook: variantSchema,
  assetPrompt: z.string().min(1),
});

const DEFAULT_MODEL = "deepseek/deepseek-v4-pro";

/** Whether a platform's composed post includes a trailing hashtag line. */
const USES_HASHTAGS: Record<Platform, boolean> = {
  x: true,
  reddit: false,
  instagram: true,
  facebook: true,
};

const PLATFORM_STYLE: Record<Platform, string> = {
  x: "X (Twitter): punchy and concise (max ~280 characters), a strong hook, at most 1–2 hashtags.",
  reddit:
    "Reddit: conversational, authentic, and specific — write like a knowledgeable community member sharing a find. No hashtags, no marketing speak.",
  instagram:
    "Instagram: warm and visual with light emoji, a short caption, then 5–10 relevant hashtags.",
  facebook:
    "Facebook: friendly and approachable, a couple of sentences, minimal hashtags.",
};

const SYSTEM = `You are a sharp social-media copywriter for a solo operator. From one piece of research, write a distinct, original post for each platform — a fresh take or hook in your own words, never a restatement of the source title. Tailor voice, length, and hashtag use to each platform's audience.`;

/**
 * Default brand voice when none is configured: emulate the *style* of
 * productivity YouTuber Ali Abdaal (this writes in his style; it does not claim
 * to be him).
 */
export const DEFAULT_VOICE = `Write in the style of productivity YouTuber Ali Abdaal: warm, friendly, and encouraging, speaking directly to "you"; lead with a curiosity-driven hook; stay optimistic and approachable; distill the idea into clear, actionable takeaways; reference studies or simple frameworks lightly and without jargon; sound credible but relaxed — no hype, clickbait, or hard-selling.`;

/** Build the voice + operator-context block appended to the system prompt. */
function voiceAndContext(opts: OpenRouterGeneratorOptions): string {
  const parts: string[] = [`Voice — write every post in this voice:\n${opts.voice?.trim() || DEFAULT_VOICE}`];

  const biz: string[] = [];
  const name = opts.businessName?.trim();
  const desc = opts.businessDescription?.trim();
  if (name || desc) biz.push([name, desc].filter(Boolean).join(" — "));

  const p = opts.profile;
  if (p) {
    if (p.goals.length) biz.push(`Goals: ${p.goals.join("; ")}.`);
    if (p.skills.length) biz.push(`Skills: ${p.skills.join(", ")}.`);
    if (p.monetizationTarget) biz.push(`Revenue target: ${p.monetizationTarget}.`);
    if (p.audience) biz.push(`Audience: ${p.audience}.`);
  }
  if (biz.length) {
    parts.push(`Operator context — tailor everything to this person:\n${biz.join("\n")}`);
  }
  return `\n\n${parts.join("\n\n")}`;
}

function tag(t: string): string {
  const trimmed = t.trim().replace(/^#+/, "");
  return trimmed ? `#${trimmed}` : "";
}

/** Shorten text to at most maxLength characters, appending an ellipsis if cut. */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return "…".slice(0, Math.max(maxLength, 0));
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function composeText(
  platform: Platform,
  caption: string,
  hashtags: string[],
  url: string,
): string {
  const tags = USES_HASHTAGS[platform] ? hashtags.map(tag).filter((t) => t.length > 0) : [];
  const suffixParts = tags.length ? [tags.join(" "), url] : [url];
  const suffix = suffixParts.map((part) => `\n\n${part}`).join("");

  let body = caption.trim();
  if (platform === "x") {
    body = truncate(body, Math.max(X_MAX_LENGTH - suffix.length, 0));
  }
  return body + suffix;
}

function engagementLine(engagement: Record<string, number>): string {
  const entries = Object.entries(engagement)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}: ${v}`);
  return entries.length ? entries.join(", ") : "n/a";
}

/**
 * An OpenRouter/DeepSeek-backed post generator: real LLM synthesis behind the
 * same seam as deterministicPostGenerator, producing one tailored variant per
 * platform in a single call. Inject a client (the factory below wires `fetch`
 * to OpenRouter); tests pass a fake.
 */
export function makeOpenRouterGenerator(
  opts: OpenRouterGeneratorOptions,
): PostGenerator {
  const model = opts.model ?? DEFAULT_MODEL;

  return {
    async generatePosts({ topic, items }) {
      const styleGuide = PLATFORMS.map(
        (p) => `- ${p}: ${PLATFORM_STYLE[p]}`,
      ).join("\n");
      const itemsBlock = items
        .map((it, i) =>
          [
            `${i + 1}. Title: ${it.title}`,
            it.snippet ? `   Snippet: ${it.snippet}` : "",
            `   Engagement: ${engagementLine(it.engagement)}`,
          ]
            .filter((line) => line !== "")
            .join("\n"),
        )
        .join("\n");
      const prompt = [
        `Topic: ${topic}`,
        "",
        "Source item(s) to synthesize from:",
        itemsBlock,
        "",
        "Write one original post per platform that synthesizes the source item(s) above into a single take, following these style rules:",
        styleGuide,
        "",
        "For each platform return a caption and an array of hashtags (without the # prefix; use an empty array where hashtags don't fit the platform).",
        "",
        "Also return assetPrompt: a detailed prompt for an AI image generator (Higgsfield) describing a single supplemental cover-image asset that visually synthesizes the source material — describe scene, style, and mood; do not request any text/words rendered in the image.",
      ]
        .filter((line) => line !== "")
        .join("\n");

      const res = await opts.client.complete({
        model,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "platform_posts",
            strict: true,
            schema: z.toJSONSchema(postsSchema),
          },
        },
        messages: [
          { role: "system", content: SYSTEM + voiceAndContext(opts) },
          { role: "user", content: prompt },
        ],
      });

      if (opts.meter && res.usage) {
        opts.meter.record(model, {
          inputTokens: res.usage.prompt_tokens ?? 0,
          outputTokens: res.usage.completion_tokens ?? 0,
        });
      }

      const parsed = postsSchema.parse(extractJson(res.content));
      const variants = {} as Record<Platform, GeneratedPost>;
      for (const p of PLATFORMS) {
        variants[p] = {
          text: composeText(p, parsed[p].caption, parsed[p].hashtags, items[0]!.url),
          hashtags: parsed[p].hashtags,
        };
      }
      return { variants, assetPrompt: parsed.assetPrompt };
    },
  };
}

/**
 * No-network fallback: composes a serviceable per-platform post from the item
 * itself so the "Generate posts" button always works (and tests/CI stay
 * hermetic) even with no OpenRouter key.
 */
export const deterministicPostGenerator: PostGenerator = {
  generatePosts({ topic, items }) {
    const hook =
      items.length === 1
        ? items[0]!.snippet?.trim() || items[0]!.title
        : items
            .map((it) => it.snippet?.trim() || it.title)
            .join("; ")
            .slice(0, 400);
    const tagBase = topic.replace(/[^a-z0-9]+/gi, "");
    const hashtags = tagBase ? [tagBase] : [];
    const captionByPlatform: Record<Platform, string> = {
      x: `${topic}: ${hook}`,
      reddit: `Came across this on ${topic} — ${hook}`,
      instagram: `✨ ${topic}\n\n${hook}`,
      facebook: `Worth a look on ${topic}: ${hook}`,
    };
    const variants = {} as Record<Platform, GeneratedPost>;
    for (const p of PLATFORMS) {
      const tags = USES_HASHTAGS[p] ? hashtags : [];
      variants[p] = {
        text: composeText(p, captionByPlatform[p], tags, items[0]!.url),
        hashtags: tags,
      };
    }
    const assetPrompt = `A clean, modern social-media cover image about "${topic}", inspired by: ${hook}. Vibrant colors, minimal-to-no text.`;
    return { variants, assetPrompt };
  },
};

/** True when at least one OpenRouter key is configured (single or pool). */
export function hasOpenRouterKeys(
  env: Record<string, string | undefined>,
): boolean {
  return parseOpenRouterKeys(env).length > 0;
}

/**
 * Pools are cached per (keys + baseUrl) so every decision stage in a run shares
 * one rotation cursor, cooldown map, and concurrency budget instead of each
 * factory spinning up its own client over the same keys.
 */
const poolCache = new Map<string, OpenRouterKeyPool>();

function getSharedPool(
  env: Record<string, string | undefined>,
): OpenRouterKeyPool {
  const keys = parseOpenRouterKeys(env);
  const baseUrl = env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const cacheKey = `${baseUrl}::${keys.join(",")}`;
  let pool = poolCache.get(cacheKey);
  if (!pool) {
    pool = new OpenRouterKeyPool({ keys, baseUrl });
    poolCache.set(cacheKey, pool);
  }
  return pool;
}

export function makeOpenRouterClient(
  env: Record<string, string | undefined>,
): PostGenClient {
  const pool = getSharedPool(env);
  return {
    complete: (body) => pool.complete(body),
  };
}

/**
 * Select the post generator: OpenRouter/DeepSeek when a key is present, else the
 * deterministic fallback. Set DECODE_REASONER=deterministic to force the
 * fallback even with a key.
 */
export function getPostGenerator(
  config: {
    model?: string;
    businessName?: string;
    businessDescription?: string;
    profile?: OperatorProfile;
    voice?: string;
  } = {},
  env: Record<string, string | undefined> = process.env,
  meter?: UsageMeter,
): PostGenerator {
  if (!env.OPENROUTER_API_KEY || env.DECODE_REASONER === "deterministic") {
    return deterministicPostGenerator;
  }
  return makeOpenRouterGenerator({
    client: makeOpenRouterClient(env),
    model: config.model ?? env.OPENROUTER_MODEL,
    businessName: config.businessName,
    businessDescription: config.businessDescription,
    profile: config.profile,
    voice: config.voice,
    meter,
  });
}
