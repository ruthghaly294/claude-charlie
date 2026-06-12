import { z } from "zod";
import type { Connector, ConnectorContext, ConnectorState, RawSignal } from "../types";
import { fetchJson } from "../fetchWithRetry";

const cfgSchema = z.object({
  enabled: z.boolean().default(false),
  /** specific handles to follow, e.g. ["realDonaldTrump", "unusual_whales"] */
  accounts: z.array(z.string()).default([]),
  /** raw query override; if set, used verbatim and nothing else is built */
  query: z.string().optional(),
  /** also run a keyword/business-name search alongside accounts (default true) */
  use_keywords: z.boolean().default(true),
});

const apiSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().default(""),
        author_id: z.string().default(""),
        created_at: z.string().default(""),
      }),
    )
    .default([]),
});

/** Max from: operators per query — keeps the search string well under limits. */
const ACCOUNTS_PER_QUERY = 20;

/**
 * Build the list of recent-search queries this connector will run. Accounts
 * become `(from:a OR from:b) -is:retweet` groups (one API call each), and—when
 * enabled—keywords (or the business name) add a topic search. Each query is a
 * separate request, like the YouTube connector.
 */
export function buildTwitterQueries(ctx: ConnectorContext): string[] {
  const parsed = cfgSchema.safeParse(ctx.config ?? {});
  const cfg = parsed.success ? parsed.data : cfgSchema.parse({});

  if (cfg.query && cfg.query.trim()) return [cfg.query.trim()];

  const out: string[] = [];
  const accounts = cfg.accounts
    .map((a) => a.replace(/^@/, "").trim())
    .filter(Boolean);

  for (let i = 0; i < accounts.length; i += ACCOUNTS_PER_QUERY) {
    const group = accounts
      .slice(i, i + ACCOUNTS_PER_QUERY)
      .map((a) => `from:${a}`)
      .join(" OR ");
    out.push(`(${group}) -is:retweet`);
  }

  if (cfg.use_keywords) {
    const base =
      ctx.keywords.length > 0
        ? ctx.keywords.join(" OR ")
        : accounts.length === 0
          ? ctx.businessName.trim()
          : "";
    if (base) out.push(`${base} -is:retweet lang:en`);
  }

  return out;
}

export const twitterConnector: Connector = {
  key: "twitter",
  label: "X / Twitter",
  requiresKeys: ["TWITTER_BEARER"],

  state(ctx: ConnectorContext) {
    const c = cfgSchema.safeParse(ctx.config ?? {});
    if (!c.success || !c.data.enabled) {
      return { configured: false, reason: "disabled in config" };
    }
    if (!ctx.env.TWITTER_BEARER) {
      return { configured: false, reason: "TWITTER_BEARER not set" };
    }
    if (buildTwitterQueries(ctx).length === 0) {
      return { configured: false, reason: "no accounts/query/keywords" };
    }
    return { configured: true };
  },

  /**
   * Cheap pre-flight probe: the bearer token returning 401 (e.g. revoked or
   * never valid) is a config problem, not a transient failure — report it as
   * "not configured" so the source runner skips this run without tripping
   * the circuit breaker.
   */
  async healthCheck(ctx: ConnectorContext): Promise<ConnectorState> {
    const bearer = ctx.env.TWITTER_BEARER as string;
    try {
      const res = await ctx.fetchImpl(
        "https://api.twitter.com/2/tweets/search/recent?max_results=10&query=test",
        { headers: { authorization: `Bearer ${bearer}` }, signal: ctx.signal },
      );
      if (res.status === 401) {
        return { configured: false, reason: "TWITTER_BEARER unauthorized (401)" };
      }
      return { configured: true };
    } catch (err) {
      return {
        configured: false,
        reason: `health check failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  async fetch(ctx: ConnectorContext): Promise<RawSignal[]> {
    const bearer = ctx.env.TWITTER_BEARER as string;
    const byId = new Map<string, RawSignal>();

    for (const q of buildTwitterQueries(ctx)) {
      const url =
        `https://api.twitter.com/2/tweets/search/recent?max_results=10` +
        `&tweet.fields=author_id,created_at&query=${encodeURIComponent(q)}`;
      const data = await fetchJson(
        url,
        apiSchema,
        { headers: { authorization: `Bearer ${bearer}` } },
        { fetchImpl: ctx.fetchImpl, signal: ctx.signal },
      );
      for (const t of data.data) {
        if (byId.has(t.id)) continue;
        byId.set(t.id, {
          source: "twitter",
          title: t.text.replace(/\s+/g, " ").slice(0, 80),
          url: `https://twitter.com/i/web/status/${t.id}`,
          author: t.author_id,
          publishedAt: t.created_at,
          tags: ["twitter"],
          raw: t.text,
        });
      }
    }

    return [...byId.values()];
  },
};
