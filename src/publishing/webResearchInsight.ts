import type { DecodeConfig } from "@/discovery/config";
import { UsageMeter } from "@/discovery/usage";
import { scrapeSources, type ScrapedSource } from "@/research/contentExtract";
import { makeOpenRouterClient, hasOpenRouterKeys, type PostGenClient } from "./postGenerator";

/**
 * A NotebookLM-free "read the sources" layer: scrape the page bodies behind the
 * top discovery picks, then have a text model distill a grounded, content-ready
 * insight from what they actually say. Feeds the same brief-grounding slot as
 * the NotebookLM insight, so the post can be built on real facts even when
 * NotebookLM is off/unconfigured.
 */
export type WebResearchInsight = {
  text: string;
  /** source URLs the insight is grounded in. */
  citations: string[];
  /** the exact user prompt sent to the model (for the UI trace). */
  prompt: string;
};

export interface WebResearchInsightProvider {
  distill(topic: string, picks: { url: string; title?: string }[]): Promise<WebResearchInsight | null>;
}

export type WebResearchInsightOptions = {
  client: PostGenClient;
  model?: string;
  /** injected scraper (defaults to the real content-extraction scraper). */
  scrape?: typeof scrapeSources;
  voiceContext?: string;
  maxSources?: number;
  meter?: UsageMeter;
};

const DEFAULT_MODEL = "deepseek/deepseek-v4-pro";

const SYSTEM = `You are a research analyst working strictly from the source excerpts provided below — never invent facts they don't support. Distill a tight, content-ready insight a short-form creator can build a video around:
- The single most counterintuitive, surprising, or under-appreciated point the sources actually support — the angle worth making content about.
- 2-4 specific, citable facts/figures/quotes from the sources (name the source domain where you can).
- Why it matters now / why an audience would care.
- What a generic take on this topic gets wrong, so the creator can differentiate.
Be concrete and specific to what the sources say. If they don't support a strong angle, say so plainly rather than padding. Output only the insight (no preamble).`;

function buildUser(topic: string, voiceContext: string, sources: ScrapedSource[]): string {
  const blocks = sources.map((s, i) => {
    let host = s.url;
    try {
      host = new URL(s.url).hostname;
    } catch {
      /* keep raw */
    }
    return `[Source ${i + 1}: ${host}]${s.title ? ` ${s.title}` : ""}\n${s.text}`;
  });
  return [`Topic: ${topic}`, voiceContext, "", "Sources:", blocks.join("\n\n")]
    .filter((l) => l !== "")
    .join("\n");
}

export function makeWebResearchInsight(opts: WebResearchInsightOptions): WebResearchInsightProvider {
  const model = opts.model ?? DEFAULT_MODEL;
  const scrape = opts.scrape ?? scrapeSources;
  return {
    async distill(topic, picks) {
      const sources = await scrape(picks, { limit: opts.maxSources ?? 5 });
      if (sources.length === 0) return null;
      const user = buildUser(topic, opts.voiceContext ?? "", sources);
      const res = await opts.client.complete({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
      });
      if (opts.meter && res.usage) {
        opts.meter.record(model, {
          inputTokens: res.usage.prompt_tokens ?? 0,
          outputTokens: res.usage.completion_tokens ?? 0,
        });
      }
      const text = res.content.trim();
      if (!text) return null;
      return { text, citations: sources.map((s) => s.url), prompt: user };
    },
  };
}

function voiceContext(config: DecodeConfig): string {
  const parts: string[] = [];
  if (config.profile?.voice?.trim()) parts.push(`Creator voice: ${config.profile.voice.trim()}`);
  const biz = [config.businessName, config.businessDescription].filter((s) => s?.trim()).join(" — ");
  if (biz) parts.push(`Brand: ${biz}`);
  return parts.length ? parts.join("\n") : "";
}

/**
 * Provider when an OpenRouter key is present (text model — no vision needed),
 * else undefined ⇒ the layer is simply skipped.
 */
export function getWebResearchInsight(
  config: DecodeConfig,
  env: Record<string, string | undefined> = process.env,
  scrape: typeof scrapeSources = scrapeSources,
  meter?: UsageMeter,
): WebResearchInsightProvider | undefined {
  if (!hasOpenRouterKeys(env) || env.DECODE_REASONER === "deterministic") return undefined;
  return makeWebResearchInsight({
    client: makeOpenRouterClient(env),
    model: env.OPENROUTER_MODEL,
    scrape,
    voiceContext: voiceContext(config),
    maxSources: config.research?.topN,
    meter,
  });
}
