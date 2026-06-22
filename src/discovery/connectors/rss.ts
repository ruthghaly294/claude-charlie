import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import type { Connector, ConnectorContext, RawSignal } from "../types";
import { fetchText } from "../fetchWithRetry";

const urlsSchema = z.array(z.string().url()).default([]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node.trim();
  if (typeof node === "object") {
    const rec = node as Record<string, unknown>;
    if (typeof rec["#text"] === "string") return rec["#text"].trim();
  }
  return "";
}

function linkOf(node: unknown): string {
  // RSS: <link>url</link> ; Atom: <link href="url"/> (possibly multiple)
  if (typeof node === "string") return node.trim();
  for (const l of asArray(node)) {
    if (typeof l === "string") return l.trim();
    if (l && typeof l === "object") {
      const rec = l as Record<string, unknown>;
      const href = rec["@_href"];
      if (typeof href === "string") return href.trim();
      const text = textOf(l);
      if (text) return text;
    }
  }
  return "";
}

/** Parse one RSS/Atom document into raw signals. Exported for tests. */
export function parseFeed(xml: string): RawSignal[] {
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }
  const root = doc as Record<string, any>;
  const items = [
    ...asArray(root?.rss?.channel?.item),
    ...asArray(root?.feed?.entry),
    ...asArray(root?.["rdf:RDF"]?.item),
  ];

  const out: RawSignal[] = [];
  for (const it of items) {
    const title = textOf(it?.title);
    const url = linkOf(it?.link);
    if (!title && !url) continue;
    out.push({
      source: "rss",
      title: title || url,
      url,
      author: textOf(it?.author?.name ?? it?.author ?? it?.["dc:creator"]),
      publishedAt: textOf(it?.pubDate ?? it?.published ?? it?.updated),
      tags: ["rss"],
      raw: textOf(it?.description ?? it?.summary ?? it?.content),
    });
  }
  return out;
}

export const rssConnector: Connector = {
  key: "rss",
  label: "RSS / Atom feeds",
  requiresKeys: [],

  state(ctx: ConnectorContext) {
    const urls = urlsSchema.safeParse(ctx.config);
    if (!urls.success || urls.data.length === 0) {
      return { configured: false, reason: "no feeds configured" };
    }
    return { configured: true };
  },

  async fetch(ctx: ConnectorContext): Promise<RawSignal[]> {
    const urls = urlsSchema.parse(ctx.config);
    const results = await Promise.allSettled(
      urls.map((u) =>
        fetchText(
          u,
          { headers: { "user-agent": "decode-bot/1.0" } },
          {
            fetchImpl: ctx.fetchImpl,
            signal: ctx.signal,
          },
        ),
      ),
    );
    const out: RawSignal[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") out.push(...parseFeed(r.value));
    }
    return out;
  },
};
