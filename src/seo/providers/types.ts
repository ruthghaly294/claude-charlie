import type { SeoSite } from "@/db/schema";

/** Where our domain ranks for one keyword, plus competitor domains above us. */
export type KeywordRanking = {
  keyword: string;
  engine: string;
  position: number | null;
  url: string;
  competitorsAhead: string[];
};

/** What a provider contributes to an audit: rank data + plain-language facts. */
export type ProviderSignals = {
  rankings: KeywordRanking[];
  /** fact strings fed verbatim to the reasoner as competitor/ranking gaps */
  notes: string[];
};

export type ProviderState = { configured: boolean; reason?: string };

export type ProviderContext = {
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

/**
 * A pluggable source of extra SEO signals. Mirrors the discovery connector
 * `state()` pattern: a provider is skipped (configured:false) until its
 * credentials/URL are present, so the free path always works and paid/optional
 * sources light up only when wired.
 */
export interface SeoDataProvider {
  key: string;
  state(ctx: ProviderContext): ProviderState;
  fetch(site: SeoSite, ctx: ProviderContext): Promise<ProviderSignals>;
}

export const EMPTY_SIGNALS: ProviderSignals = { rankings: [], notes: [] };
