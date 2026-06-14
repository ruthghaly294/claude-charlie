import { z } from "zod";
import type { ResearchItem } from "@/research/last30days";
import { UsageMeter } from "@/discovery/usage";

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

export interface PostGenerator {
  generatePost(input: {
    topic: string;
    item: ResearchItem;
  }): GeneratedPost | Promise<GeneratedPost>;
}

export type OpenRouterGeneratorOptions = {
  client: PostGenClient;
  model?: string;
  /** records token usage + cost for the post-generation call */
  meter?: UsageMeter;
};

const captionSchema = z.object({
  caption: z.string().min(1),
  hashtags: z.array(z.string()),
});

const DEFAULT_MODEL = "deepseek/deepseek-v4-pro";

const SYSTEM = `You are a sharp social-media copywriter for a solo operator. Turn a single piece of research into ONE original, engaging post in your own words — a fresh take or hook, never a restatement of the source title. Keep it concise (2–4 sentences), specific, and free of hype or hashtags in the caption itself.`;

function tag(t: string): string {
  const trimmed = t.trim().replace(/^#+/, "");
  return trimmed ? `#${trimmed}` : "";
}

function composeText(caption: string, hashtags: string[], url: string): string {
  const tags = hashtags.map(tag).filter((t) => t.length > 0);
  const parts = [caption.trim()];
  if (tags.length) parts.push(tags.join(" "));
  parts.push(url);
  return parts.join("\n\n");
}

function engagementLine(engagement: Record<string, number>): string {
  const entries = Object.entries(engagement)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}: ${v}`);
  return entries.length ? entries.join(", ") : "n/a";
}

/**
 * An OpenRouter/DeepSeek-backed post generator: real LLM synthesis behind the
 * same seam as deterministicPostGenerator. Inject a client (the factory below
 * wires `fetch` to OpenRouter); tests pass a fake.
 */
export function makeOpenRouterGenerator(
  opts: OpenRouterGeneratorOptions,
): PostGenerator {
  const model = opts.model ?? DEFAULT_MODEL;

  return {
    async generatePost({ topic, item }) {
      const prompt = [
        `Topic: ${topic}`,
        "",
        "Source item to synthesize from:",
        `Title: ${item.title}`,
        item.snippet ? `Snippet: ${item.snippet}` : "",
        `Engagement: ${engagementLine(item.engagement)}`,
        "",
        "Write one original post about this, then suggest 2–5 relevant hashtags (without the # prefix).",
      ]
        .filter((line) => line !== "")
        .join("\n");

      const res = await opts.client.complete({
        model,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "social_post",
            strict: true,
            schema: z.toJSONSchema(captionSchema),
          },
        },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
      });

      if (opts.meter && res.usage) {
        opts.meter.record(model, {
          inputTokens: res.usage.prompt_tokens ?? 0,
          outputTokens: res.usage.completion_tokens ?? 0,
        });
      }

      const parsed = captionSchema.parse(JSON.parse(res.content));
      return {
        text: composeText(parsed.caption, parsed.hashtags, item.url),
        hashtags: parsed.hashtags,
      };
    },
  };
}

/**
 * No-network fallback: composes a serviceable post from the item itself so the
 * "Generate post" button always works (and tests/CI stay hermetic) even with no
 * OpenRouter key.
 */
export const deterministicPostGenerator: PostGenerator = {
  generatePost({ topic, item }) {
    const hook = item.snippet?.trim() || item.title;
    const caption = `On ${topic}: ${hook}`;
    const hashtags = [topic.replace(/[^a-z0-9]+/gi, "")].filter(
      (t) => t.length > 0,
    );
    return {
      text: composeText(caption, hashtags, item.url),
      hashtags,
    };
  },
};

function makeOpenRouterClient(
  env: Record<string, string | undefined>,
): PostGenClient {
  const apiKey = env.OPENROUTER_API_KEY;
  const baseUrl = env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  return {
    async complete(body) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `OpenRouter request failed (${res.status})${detail ? `: ${detail}` : ""}`,
        );
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("OpenRouter response missing message content");
      }
      return { content, usage: json.usage };
    },
  };
}

/**
 * Select the post generator: OpenRouter/DeepSeek when a key is present, else the
 * deterministic fallback. Set DECODE_REASONER=deterministic to force the
 * fallback even with a key.
 */
export function getPostGenerator(
  config: { model?: string } = {},
  env: Record<string, string | undefined> = process.env,
  meter?: UsageMeter,
): PostGenerator {
  if (!env.OPENROUTER_API_KEY || env.DECODE_REASONER === "deterministic") {
    return deterministicPostGenerator;
  }
  return makeOpenRouterGenerator({
    client: makeOpenRouterClient(env),
    model: config.model ?? env.OPENROUTER_MODEL,
    meter,
  });
}
