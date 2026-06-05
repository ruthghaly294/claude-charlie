import { z } from "zod";
import type { Connector, ConnectorContext, RawSignal } from "../types";
import { fetchJson } from "../fetchWithRetry";

const cfgSchema = z.object({ query: z.string().default("") });

const apiSchema = z.object({
  hits: z
    .array(
      z.object({
        title: z.string().nullable().default(""),
        url: z.string().nullable().default(""),
        author: z.string().nullable().default(""),
        objectID: z.string().default(""),
      }),
    )
    .default([]),
});

function effectiveQuery(ctx: ConnectorContext): string {
  const c = cfgSchema.safeParse(ctx.config ?? {});
  const configured = c.success ? c.data.query.trim() : "";
  if (configured) return configured;
  if (ctx.keywords.length > 0) return ctx.keywords.join(" OR ");
  return ctx.businessName.trim();
}

export const hackernewsConnector: Connector = {
  key: "hackernews",
  label: "Hacker News",
  requiresKeys: [],

  state(ctx: ConnectorContext) {
    if (!effectiveQuery(ctx)) {
      return {
        configured: false,
        reason: "no query (set hackernews.query or keywords)",
      };
    }
    return { configured: true };
  },

  async fetch(ctx: ConnectorContext): Promise<RawSignal[]> {
    const query = effectiveQuery(ctx);
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story`;
    const data = await fetchJson(
      url,
      apiSchema,
      {},
      {
        fetchImpl: ctx.fetchImpl,
        signal: ctx.signal,
      },
    );
    return data.hits.map((h) => ({
      source: "hackernews",
      title: h.title ?? "",
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      author: h.author ?? "",
      publishedAt: "",
      tags: ["hackernews"],
      raw: "",
    }));
  },
};
