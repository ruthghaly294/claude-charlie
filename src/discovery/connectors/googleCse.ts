import { z } from "zod";
import type { Connector, ConnectorContext, RawSignal } from "../types";
import { fetchJson } from "../fetchWithRetry";

const cfgSchema = z.object({ enabled: z.boolean().default(false) });

const apiSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().default(""),
        link: z.string().default(""),
        snippet: z.string().default(""),
        displayLink: z.string().default(""),
      }),
    )
    .default([]),
});

function query(ctx: ConnectorContext): string {
  if (ctx.keywords.length > 0) return ctx.keywords.join(" OR ");
  return ctx.businessName.trim();
}

export const googleCseConnector: Connector = {
  key: "google_cse",
  label: "Google Custom Search",
  requiresKeys: ["GOOGLE_CSE_KEY", "GOOGLE_CSE_ID"],

  state(ctx: ConnectorContext) {
    const c = cfgSchema.safeParse(ctx.config ?? {});
    if (!c.success || !c.data.enabled) {
      return { configured: false, reason: "disabled in config" };
    }
    if (!ctx.env.GOOGLE_CSE_KEY || !ctx.env.GOOGLE_CSE_ID) {
      return {
        configured: false,
        reason: "GOOGLE_CSE_KEY / GOOGLE_CSE_ID not set",
      };
    }
    if (!query(ctx)) return { configured: false, reason: "no query/keywords" };
    return { configured: true };
  },

  async fetch(ctx: ConnectorContext): Promise<RawSignal[]> {
    const key = ctx.env.GOOGLE_CSE_KEY as string;
    const cx = ctx.env.GOOGLE_CSE_ID as string;
    const queries = [query(ctx), ...(ctx.queries ?? [])];

    const byUrl = new Map<string, RawSignal>();
    for (const q of queries) {
      const url =
        `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}` +
        `&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}`;
      const data = await fetchJson(
        url,
        apiSchema,
        {},
        {
          fetchImpl: ctx.fetchImpl,
          signal: ctx.signal,
        },
      );
      for (const i of data.items) {
        if (byUrl.has(i.link)) continue;
        byUrl.set(i.link, {
          source: "google",
          title: i.title,
          url: i.link,
          author: i.displayLink,
          publishedAt: "",
          tags: ["google"],
          raw: i.snippet,
          authorKey: `google:${i.displayLink}`,
        });
      }
    }
    return [...byUrl.values()];
  },
};
