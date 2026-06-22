import { z } from "zod";
import { fetchJson, type FetchRetryOptions } from "@/discovery/fetchWithRetry";
import type { SeoSite } from "@/db/schema";
import {
  EMPTY_SIGNALS,
  type KeywordRanking,
  type ProviderContext,
  type ProviderSignals,
  type ProviderState,
  type SeoDataProvider,
} from "./types";

const searxResultSchema = z
  .object({
    results: z
      .array(z.object({ url: z.string().default(""), title: z.string().default("") }))
      .default([]),
  })
  .passthrough();

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Domain (host) for a tracked site or competitor URL. */
export function domainHost(value: string): string {
  return hostOf(/^https?:\/\//.test(value) ? value : `https://${value}`);
}

/**
 * Reduce a ranked SERP result list to our position + which competitor domains
 * outrank us. Pure + deterministic so it's unit-testable without a SearXNG box.
 */
export function rankingFromResults(
  keyword: string,
  resultUrls: string[],
  ourDomain: string,
  competitorDomains: string[],
  engine = "searxng",
): KeywordRanking {
  const ours = domainHost(ourDomain);
  const competitors = new Set(competitorDomains.map(domainHost).filter(Boolean));

  let position: number | null = null;
  let url = "";
  const competitorsAhead: string[] = [];
  const seenCompetitors = new Set<string>();

  resultUrls.forEach((resultUrl, i) => {
    const host = hostOf(resultUrl);
    if (host === ours && position === null) {
      position = i + 1;
      url = resultUrl;
    }
    if (position === null && competitors.has(host) && !seenCompetitors.has(host)) {
      seenCompetitors.add(host);
      competitorsAhead.push(host);
    }
  });

  return { keyword, engine, position, url, competitorsAhead };
}

function rankingNote(r: KeywordRanking): string {
  if (r.position !== null) {
    const ahead = r.competitorsAhead.length
      ? ` (behind ${r.competitorsAhead.join(", ")})`
      : "";
    return `Ranks #${r.position} for "${r.keyword}"${ahead}.`;
  }
  if (r.competitorsAhead.length) {
    return `Not ranking for "${r.keyword}"; competitors ${r.competitorsAhead.join(", ")} appear ahead.`;
  }
  return `Not ranking in the top results for "${r.keyword}".`;
}

/**
 * SERP/rank provider backed by a self-hosted SearXNG instance (queried over its
 * JSON API — no SearXNG code is bundled). Activates only when SEO_SERP_URL is
 * set, keeping the free on-page path fully functional without it.
 */
export const searxngProvider: SeoDataProvider = {
  key: "searxng",

  state(ctx: ProviderContext): ProviderState {
    return ctx.env.SEO_SERP_URL
      ? { configured: true }
      : { configured: false, reason: "set SEO_SERP_URL to a self-hosted SearXNG instance" };
  },

  async fetch(site: SeoSite, ctx: ProviderContext): Promise<ProviderSignals> {
    const base = ctx.env.SEO_SERP_URL;
    if (!base) return EMPTY_SIGNALS;
    const fetchOpts: FetchRetryOptions = {
      fetchImpl: ctx.fetchImpl,
      signal: ctx.signal,
      retries: 1,
    };

    const rankings: KeywordRanking[] = [];
    for (const keyword of site.keywords) {
      const url = `${base.replace(/\/$/, "")}/search?q=${encodeURIComponent(keyword)}&format=json`;
      try {
        const data = await fetchJson(url, searxResultSchema, {}, fetchOpts);
        const urls = data.results.map((r) => r.url).filter(Boolean);
        rankings.push(rankingFromResults(keyword, urls, site.domain, site.competitors));
      } catch {
        continue;
      }
    }

    return { rankings, notes: rankings.map(rankingNote) };
  },
};
