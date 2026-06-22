import { z } from "zod";
import type { Connector, ConnectorContext, RawSignal } from "../types";
import { fetchJson } from "../fetchWithRetry";

const cfgSchema = z.object({ queries: z.array(z.string()).default([]) });

const apiSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.object({ videoId: z.string().optional() }).optional(),
        snippet: z
          .object({
            title: z.string().default(""),
            channelTitle: z.string().default(""),
            publishedAt: z.string().default(""),
            description: z.string().default(""),
          })
          .optional(),
      }),
    )
    .default([]),
});

function queries(ctx: ConnectorContext): string[] {
  const c = cfgSchema.safeParse(ctx.config ?? {});
  const configured = c.success ? c.data.queries : [];
  const base =
    configured.length > 0
      ? configured
      : ctx.keywords.length > 0
        ? ctx.keywords
        : ctx.businessName
          ? [ctx.businessName]
          : [];
  return [...new Set([...base, ...(ctx.queries ?? [])])];
}

export const youtubeConnector: Connector = {
  key: "youtube",
  label: "YouTube",
  requiresKeys: ["YOUTUBE_API_KEY"],

  state(ctx: ConnectorContext) {
    if (!ctx.env.YOUTUBE_API_KEY) {
      return { configured: false, reason: "YOUTUBE_API_KEY not set" };
    }
    if (queries(ctx).length === 0) {
      return { configured: false, reason: "no queries/keywords configured" };
    }
    return { configured: true };
  },

  async fetch(ctx: ConnectorContext): Promise<RawSignal[]> {
    const key = ctx.env.YOUTUBE_API_KEY as string;
    const out: RawSignal[] = [];
    for (const q of queries(ctx)) {
      const url =
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video` +
        `&maxResults=5&q=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`;
      const data = await fetchJson(
        url,
        apiSchema,
        {},
        {
          fetchImpl: ctx.fetchImpl,
          signal: ctx.signal,
        },
      );
      for (const item of data.items) {
        const vid = item.id?.videoId;
        if (!vid) continue;
        out.push({
          source: "youtube",
          title: item.snippet?.title ?? "",
          url: `https://www.youtube.com/watch?v=${vid}`,
          author: item.snippet?.channelTitle ?? "",
          publishedAt: item.snippet?.publishedAt ?? "",
          tags: ["youtube"],
          raw: item.snippet?.description ?? "",
          authorKey: `youtube:${item.snippet?.channelTitle ?? ""}`,
        });
      }
    }
    return out;
  },
};
