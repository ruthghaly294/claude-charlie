import { z } from "zod";
import type { Connector, ConnectorContext, RawSignal } from "../types";
import { fetchJson } from "../fetchWithRetry";

const cfgSchema = z.object({
  subreddits: z.array(z.string()).default([]),
});

const apiSchema = z.object({
  data: z.object({
    children: z
      .array(
        z.object({
          data: z.object({
            title: z.string().default(""),
            permalink: z.string().default(""),
            author: z.string().default(""),
            selftext: z.string().default(""),
          }),
        }),
      )
      .default([]),
  }),
});

export const redditConnector: Connector = {
  key: "reddit",
  label: "Reddit",
  requiresKeys: [],

  state(ctx: ConnectorContext) {
    const c = cfgSchema.safeParse(ctx.config ?? {});
    if (!c.success || c.data.subreddits.length === 0) {
      return { configured: false, reason: "no subreddits configured" };
    }
    return { configured: true };
  },

  async fetch(ctx: ConnectorContext): Promise<RawSignal[]> {
    const { subreddits } = cfgSchema.parse(ctx.config ?? {});
    const out: RawSignal[] = [];
    for (const sub of subreddits) {
      const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/hot.json?limit=10`;
      const data = await fetchJson(
        url,
        apiSchema,
        { headers: { "user-agent": "decode-bot/1.0 (intelligence scanner)" } },
        { fetchImpl: ctx.fetchImpl, signal: ctx.signal },
      );
      for (const child of data.data.children) {
        const p = child.data;
        out.push({
          source: "reddit",
          title: p.title,
          url: `https://www.reddit.com${p.permalink}`,
          author: p.author,
          publishedAt: "",
          tags: ["reddit", sub],
          raw: p.selftext,
        });
      }
    }
    return out;
  },
};
