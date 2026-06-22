import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { DB } from "@/db/client";
import { entities } from "@/db/schema";
import type { UsageMeter } from "@/discovery/usage";
import { entityKindSchema } from "./research";

/**
 * Minimal structural view of the Anthropic client we depend on. Keeping it tiny
 * lets tests inject a fake without pulling in the SDK's full type surface.
 */
export interface EntityRefreshClient {
  messages: {
    parse: (body: Record<string, unknown>) => Promise<{
      parsed_output: unknown;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>;
  };
}

const proposalSchema = z.object({
  keyword: z.string(),
  kind: entityKindSchema,
  value: z.string(),
  weight: z.number().optional(),
});

const proposalsSchema = z.object({ entities: z.array(proposalSchema) });

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_MAX_PROPOSALS = 10;

const SYSTEM = `You research where a topic's most engaged communities live online. Given keywords, propose specific subreddits, GitHub topics, YouTube search queries, authors/accounts, hashtags, or RSS feeds that surface high-signal content for those keywords. Be specific (real subreddit names without "r/", real GitHub topic slugs, etc.) — no generic placeholders.`;

export type EntityRefreshOptions = {
  client?: EntityRefreshClient | null;
  model?: string;
  meter?: UsageMeter;
  now?: () => string;
  /** cap on how many new entities a single refresh proposes (default 10) */
  maxProposals?: number;
};

/**
 * Ask Claude to propose new research entities (subreddits, GitHub topics,
 * YouTube queries, authors, hashtags, feeds) for the configured keywords,
 * skipping anything that already exists (by kind+value). Proposals are
 * inserted with status "proposed" / source "claude" — a human (or
 * decisionLifecycle) promotes them to "active" later. No-op without a
 * configured client.
 */
export async function refreshEntities(
  db: DB,
  config: { keywords: string[] },
  opts: EntityRefreshOptions = {},
): Promise<{ proposed: number }> {
  if (!opts.client) return { proposed: 0 };

  const model = opts.model ?? DEFAULT_MODEL;
  const existing = db.select().from(entities).all();
  const seen = new Set(existing.map((e) => `${e.kind}:${e.value}`));

  const res = await opts.client.messages.parse({
    model,
    max_tokens: 2000,
    output_config: { format: zodOutputFormat(proposalsSchema), effort: "low" },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Keywords: ${config.keywords.join(", ")}\n\nPropose research entities for these keywords.`,
      },
    ],
  });
  if (opts.meter && res.usage) {
    opts.meter.record(model, {
      inputTokens: res.usage.input_tokens ?? 0,
      outputTokens: res.usage.output_tokens ?? 0,
    });
  }

  const { entities: proposals } = proposalsSchema.parse(res.parsed_output);
  const now = opts.now ?? (() => new Date().toISOString());
  const maxProposals = opts.maxProposals ?? DEFAULT_MAX_PROPOSALS;

  const rows: (typeof entities.$inferInsert)[] = [];
  for (const p of proposals) {
    if (rows.length >= maxProposals) break;
    const key = `${p.kind}:${p.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: randomUUID(),
      keyword: p.keyword,
      kind: p.kind,
      value: p.value,
      weight: p.weight ?? 1,
      status: "proposed",
      source: "claude",
      createdAt: now(),
    });
  }

  if (rows.length > 0) db.insert(entities).values(rows).run();
  return { proposed: rows.length };
}

/**
 * Build a real Anthropic-backed client, unless ANTHROPIC_API_KEY is absent or
 * DECODE_REASONER=deterministic (same fallback rule as claudeReasoner.ts).
 */
export function getEntityRefreshClient(
  env: Record<string, string | undefined> = process.env,
): EntityRefreshClient | null {
  if (!env.ANTHROPIC_API_KEY || env.DECODE_REASONER === "deterministic") return null;
  return new Anthropic() as unknown as EntityRefreshClient;
}
