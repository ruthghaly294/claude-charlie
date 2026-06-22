import type { SeoSite } from "@/db/schema";
import {
  EMPTY_SIGNALS,
  type ProviderContext,
  type ProviderSignals,
  type ProviderState,
  type SeoDataProvider,
} from "./types";

/**
 * Google Search Console provider (real impressions/clicks/queries). Scaffolded
 * behind the provider interface and gated on a service-account credential so it
 * stays inert until you wire it up — no interactive OAuth on the free path.
 * Returns no signals until GSC_SA_JSON is supplied and the query layer lands.
 */
export const googleSearchConsoleProvider: SeoDataProvider = {
  key: "google-search-console",

  state(ctx: ProviderContext): ProviderState {
    if (!ctx.env.GSC_SA_JSON) {
      return { configured: false, reason: "set GSC_SA_JSON (service-account JSON) to enable" };
    }
    return { configured: false, reason: "GSC credentials detected; query integration pending" };
  },

  async fetch(_site: SeoSite, _ctx: ProviderContext): Promise<ProviderSignals> {
    return EMPTY_SIGNALS;
  },
};
