import { z } from "zod";
import type { Connector, ConnectorContext, RawSignal } from "../types";
import { fetchJson } from "../fetchWithRetry";

const cfgSchema = z.object({ enabled: z.boolean().default(false) });

const apiSchema = z.object({
  data: z.object({
    posts: z.object({
      edges: z
        .array(
          z.object({
            node: z.object({
              name: z.string().default(""),
              tagline: z.string().default(""),
              url: z.string().default(""),
              votesCount: z.number().default(0),
            }),
          }),
        )
        .default([]),
    }),
  }),
});

const GQL = JSON.stringify({
  query:
    "{ posts(order: VOTES, first: 10) { edges { node { name tagline url votesCount } } } }",
});

export const productHuntConnector: Connector = {
  key: "producthunt",
  label: "Product Hunt",
  requiresKeys: ["PRODUCTHUNT_TOKEN"],

  state(ctx: ConnectorContext) {
    const c = cfgSchema.safeParse(ctx.config ?? {});
    if (!c.success || !c.data.enabled) {
      return { configured: false, reason: "disabled in config" };
    }
    if (!ctx.env.PRODUCTHUNT_TOKEN) {
      return { configured: false, reason: "PRODUCTHUNT_TOKEN not set" };
    }
    return { configured: true };
  },

  async fetch(ctx: ConnectorContext): Promise<RawSignal[]> {
    const token = ctx.env.PRODUCTHUNT_TOKEN as string;
    const data = await fetchJson(
      "https://api.producthunt.com/v2/api/graphql",
      apiSchema,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: GQL,
      },
      { fetchImpl: ctx.fetchImpl, signal: ctx.signal },
    );
    return data.data.posts.edges.map((e) => ({
      source: "producthunt",
      title: e.node.name,
      url: e.node.url,
      author: "",
      publishedAt: "",
      tags: ["producthunt"],
      raw: `${e.node.tagline} ▲${e.node.votesCount}`,
    }));
  },
};
