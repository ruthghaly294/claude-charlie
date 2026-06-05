import { z } from "zod";
import type { Connector, ConnectorContext, RawSignal } from "../types";
import { fetchJson } from "../fetchWithRetry";

const cfgSchema = z.object({ enabled: z.boolean().default(false) });

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

function query(ctx: ConnectorContext): string {
  const base =
    ctx.keywords.length > 0
      ? ctx.keywords.join(" OR ")
      : ctx.businessName.trim();
  return base ? `${base} -is:retweet lang:en` : "";
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
    if (!query(ctx)) return { configured: false, reason: "no query/keywords" };
    return { configured: true };
  },

  async fetch(ctx: ConnectorContext): Promise<RawSignal[]> {
    const bearer = ctx.env.TWITTER_BEARER as string;
    const url =
      `https://api.twitter.com/2/tweets/search/recent?max_results=10` +
      `&tweet.fields=author_id,created_at&query=${encodeURIComponent(query(ctx))}`;
    const data = await fetchJson(
      url,
      apiSchema,
      { headers: { authorization: `Bearer ${bearer}` } },
      { fetchImpl: ctx.fetchImpl, signal: ctx.signal },
    );
    return data.data.map((t) => ({
      source: "twitter",
      title: t.text.replace(/\s+/g, " ").slice(0, 80),
      url: `https://twitter.com/i/web/status/${t.id}`,
      author: t.author_id,
      publishedAt: t.created_at,
      tags: ["twitter"],
      raw: t.text,
    }));
  },
};
