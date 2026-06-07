import { z } from "zod";
import type { Connector, ConnectorContext, RawSignal } from "../types";
import { fetchText } from "../fetchWithRetry";
import { parseFeed } from "./rss";

const cfgSchema = z.object({
  subreddits: z.array(z.string()).default([]),
});

// Reddit blocks its JSON API from datacenter IPs (403) but serves the public
// .rss feed to a browser-like User-Agent — so we read that and parse it.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

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
    const results = await Promise.allSettled(
      subreddits.map((sub) =>
        fetchText(
          `https://www.reddit.com/r/${encodeURIComponent(sub)}/hot.rss?limit=15`,
          { headers: { "user-agent": UA } },
          { fetchImpl: ctx.fetchImpl, signal: ctx.signal },
        ).then((xml) => ({ sub, xml })),
      ),
    );

    const out: RawSignal[] = [];
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const item of parseFeed(r.value.xml)) {
        out.push({ ...item, source: "reddit", tags: ["reddit", r.value.sub] });
      }
    }
    return out;
  },
};
