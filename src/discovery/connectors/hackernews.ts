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
        points: z.number().nullable().default(0),
        num_comments: z.number().nullable().default(0),
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
    if (!effectiveQuery(ctx) && (ctx.queries?.length ?? 0) === 0) {
      return {
        configured: false,
        reason: "no query (set hackernews.query or keywords)",
      };
    }
    return { configured: true };
  },

  async fetch(ctx: ConnectorContext): Promise<RawSignal[]> {
    const queries =
      ctx.queries && ctx.queries.length > 0 ? ctx.queries : [effectiveQuery(ctx)];

    const byId = new Map<string, RawSignal>();
    for (const query of queries) {
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
      for (const h of data.hits) {
        if (byId.has(h.objectID)) continue;
        byId.set(h.objectID, {
          source: "hackernews",
          title: h.title ?? "",
          url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
          author: h.author ?? "",
          publishedAt: "",
          tags: ["hackernews"],
          raw: "",
          points: h.points ?? 0,
          comments: h.num_comments ?? 0,
          authorKey: `hackernews:${h.author ?? ""}`,
        });
      }
    }
    return [...byId.values()];
  },
};
