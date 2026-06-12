import { z } from "zod";
import type { Connector, ConnectorContext, RawSignal } from "../types";
import { fetchWithRetry } from "../fetchWithRetry";

const cfgSchema = z.object({
  topics: z.array(z.string()).default([]),
  window: z.enum(["daily", "weekly", "monthly"]).default("weekly"),
  /** follow the Link: rel="next" header up to this many pages per topic */
  max_pages: z.number().int().min(1).max(10).default(3),
});

const apiSchema = z.object({
  items: z
    .array(
      z.object({
        full_name: z.string(),
        html_url: z.string(),
        description: z.string().nullable().default(""),
        stargazers_count: z.number().default(0),
        owner: z.object({ login: z.string() }).optional(),
      }),
    )
    .default([]),
});

function sinceDate(window: "daily" | "weekly" | "monthly"): string {
  const days = window === "daily" ? 1 : window === "monthly" ? 30 : 7;
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Parse the rel="next" target url out of a GitHub `Link` response header. */
export function parseNextLink(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return undefined;
}

export const githubConnector: Connector = {
  key: "github_trending",
  label: "GitHub trending",
  requiresKeys: [],

  state(ctx: ConnectorContext) {
    const c = cfgSchema.safeParse(ctx.config ?? {});
    if (!c.success || c.data.topics.length === 0) {
      return { configured: false, reason: "no topics configured" };
    }
    return { configured: true };
  },

  async fetch(ctx: ConnectorContext): Promise<RawSignal[]> {
    const { topics, window, max_pages } = cfgSchema.parse(ctx.config ?? {});
    const since = sinceDate(window);
    const out: RawSignal[] = [];
    for (const topic of topics) {
      const q = encodeURIComponent(`topic:${topic} created:>${since}`);
      let url: string | undefined =
        `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=10`;

      for (let page = 0; page < max_pages && url; page++) {
        const res = await fetchWithRetry(
          url,
          {
            headers: {
              accept: "application/vnd.github+json",
              "user-agent": "decode-bot/1.0",
            },
          },
          { fetchImpl: ctx.fetchImpl, signal: ctx.signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const data = apiSchema.parse(await res.json());
        for (const r of data.items) {
          out.push({
            source: "github",
            title: r.full_name,
            url: r.html_url,
            author: r.owner?.login ?? "",
            publishedAt: "",
            tags: ["github", topic],
            raw: `${r.description ?? ""} ★${r.stargazers_count}`,
          });
        }
        url = parseNextLink(res.headers.get("link"));
      }
    }
    return out;
  },
};
