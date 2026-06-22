import type { SeoSite } from "@/db/schema";
import {
  EMPTY_SIGNALS,
  type ProviderContext,
  type ProviderSignals,
  type ProviderState,
  type SeoDataProvider,
} from "./types";

/**
 * Google Analytics 4 provider (top pages / engagement, used to prioritize which
 * pages to optimize). Scaffolded behind the provider interface and gated on a
 * service-account credential; inert until GA4_SA_JSON + a property id are wired.
 */
export const ga4Provider: SeoDataProvider = {
  key: "ga4",

  state(ctx: ProviderContext): ProviderState {
    if (!ctx.env.GA4_SA_JSON || !ctx.env.GA4_PROPERTY_ID) {
      return { configured: false, reason: "set GA4_SA_JSON + GA4_PROPERTY_ID to enable" };
    }
    return { configured: false, reason: "GA4 credentials detected; query integration pending" };
  },

  async fetch(_site: SeoSite, _ctx: ProviderContext): Promise<ProviderSignals> {
    return EMPTY_SIGNALS;
  },
};
