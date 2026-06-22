import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { DB } from "@/db/client";
import { extractionCache } from "@/db/schema";
import type { UsageMeter } from "@/discovery/usage";

/**
 * Minimal structural view of the Anthropic client we depend on. Keeping it tiny
 * lets tests inject a fake without pulling in the SDK's full type surface.
 */
export interface ExtractClient {
  messages: {
    parse: (body: Record<string, unknown>) => Promise<{
      parsed_output: unknown;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>;
  };
}

export type ExtractedFields = {
  address?: string;
  postcode?: string;
  askingPrice?: number;
  beds?: number;
  propertyType?: string;
  sizeSqm?: number;
};

const fieldsSchema = z.object({
  address: z.string().optional(),
  postcode: z.string().optional(),
  askingPrice: z.number().optional(),
  beds: z.number().optional(),
  propertyType: z.string().optional(),
  sizeSqm: z.number().optional(),
});

const MAX_CHARS = 6000;
const DEFAULT_MODEL = "claude-opus-4-8";

const SYSTEM = `You extract structured property-listing data from raw estate-agent web page text. Return only the fields you can find; omit anything not present. Prices are in GBP (numeric, no currency symbol), sizes in square metres.`;

/** Strip tags + collapse whitespace, then cap to MAX_CHARS so the repair call stays cheap. */
function stripForLlm(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CHARS);
}

export type LlmExtractOptions = {
  client?: ExtractClient | null;
  model?: string;
  meter?: UsageMeter;
};

/**
 * Ask Claude to fill in listing fields the deterministic extractor missed, from
 * the page's stripped text. Returns null without a configured client — the
 * deterministic (regex/JSON-LD) result is used as-is in that case.
 */
export async function repairExtraction(
  html: string,
  url: string,
  opts: LlmExtractOptions = {},
): Promise<ExtractedFields | null> {
  if (!opts.client) return null;
  const model = opts.model ?? DEFAULT_MODEL;
  const text = stripForLlm(html);
  const res = await opts.client.messages.parse({
    model,
    max_tokens: 1000,
    output_config: { format: zodOutputFormat(fieldsSchema), effort: "low" },
    system: SYSTEM,
    messages: [{ role: "user", content: `URL: ${url}\n\nPage text:\n${text}` }],
  });
  if (opts.meter && res.usage) {
    opts.meter.record(model, {
      inputTokens: res.usage.input_tokens ?? 0,
      outputTokens: res.usage.output_tokens ?? 0,
    });
  }
  return fieldsSchema.parse(res.parsed_output);
}

/**
 * Build a real Anthropic-backed client, unless ANTHROPIC_API_KEY is absent or
 * DECODE_REASONER=deterministic (same fallback rule as claudeReasoner.ts).
 */
export function getExtractClient(
  env: Record<string, string | undefined> = process.env,
): ExtractClient | null {
  if (!env.ANTHROPIC_API_KEY || env.DECODE_REASONER === "deterministic") return null;
  return new Anthropic() as unknown as ExtractClient;
}

function hashHtml(html: string): string {
  return createHash("sha1").update(html).digest("hex");
}

/**
 * repairExtraction with a per-HTML cache (extractionCache, keyed by sha1(html)):
 * a cache hit never calls the model again, even across runs and even without a
 * client configured. A cache miss without a configured client returns null
 * uncached, so repair is retried once a key becomes available.
 */
export async function repairExtractionCached(
  db: DB,
  html: string,
  url: string,
  opts: LlmExtractOptions & { now?: () => string } = {},
): Promise<ExtractedFields | null> {
  const htmlHash = hashHtml(html);
  const cached = db.select().from(extractionCache).where(eq(extractionCache.htmlHash, htmlHash)).get();
  if (cached) return JSON.parse(cached.fields) as ExtractedFields;

  const fields = await repairExtraction(html, url, opts);
  if (!fields) return null;

  const now = opts.now ?? (() => new Date().toISOString());
  db.insert(extractionCache)
    .values({
      htmlHash,
      url,
      fields: JSON.stringify(fields),
      model: opts.model ?? DEFAULT_MODEL,
      createdAt: now(),
    })
    .onConflictDoNothing()
    .run();
  return fields;
}
