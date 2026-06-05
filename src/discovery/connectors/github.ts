import { z } from "zod";
import type { Connector, ConnectorContext, RawSignal } from "../types";
import { fetchJson } from "../fetchWithRetry";

const cfgSchema = z.object({
  topics: z.array(z.string()).default([]),
  window: z.enum(["daily", "weekly", "monthly"]).default("weekly"),
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
    const { topics, window } = cfgSchema.parse(ctx.config ?? {});
    const since = sinceDate(window);
    const out: RawSignal[] = [];
    for (const topic of topics) {
      const q = encodeURIComponent(`topic:${topic} created:>${since}`);
      const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=10`;
      const data = await fetchJson(
        url,
        apiSchema,
        {
          headers: {
            accept: "application/vnd.github+json",
            "user-agent": "decode-bot/1.0",
          },
        },
        { fetchImpl: ctx.fetchImpl, signal: ctx.signal },
      );
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
    }
    return out;
  },
};
