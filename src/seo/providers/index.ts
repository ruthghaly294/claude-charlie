import type { SeoSite } from "@/db/schema";
import { searxngProvider } from "./searxng";
import { googleSearchConsoleProvider } from "./googleSearchConsole";
import { ga4Provider } from "./ga4";
import {
  EMPTY_SIGNALS,
  type ProviderContext,
  type ProviderSignals,
  type SeoDataProvider,
} from "./types";

export * from "./types";
export { searxngProvider, rankingFromResults, domainHost } from "./searxng";

/** All known providers; the crawl path is always-on and lives outside this set. */
export const ALL_PROVIDERS: SeoDataProvider[] = [
  searxngProvider,
  googleSearchConsoleProvider,
  ga4Provider,
];

export type ProviderStatus = { key: string; configured: boolean; reason?: string };

/** Report which providers are live vs. why they're skipped (for the dashboard). */
export function providerStatuses(
  ctx: ProviderContext,
  providers: SeoDataProvider[] = ALL_PROVIDERS,
): ProviderStatus[] {
  return providers.map((p) => ({ key: p.key, ...p.state(ctx) }));
}

function mergeSignals(parts: ProviderSignals[]): ProviderSignals {
  return {
    rankings: parts.flatMap((p) => p.rankings),
    notes: parts.flatMap((p) => p.notes),
  };
}

/**
 * Run every configured provider for a site and merge their signals. Unconfigured
 * providers are skipped; a provider that throws is isolated (its failure can't
 * sink the audit).
 */
export async function gatherProviderSignals(
  site: SeoSite,
  ctx: ProviderContext,
  providers: SeoDataProvider[] = ALL_PROVIDERS,
): Promise<ProviderSignals> {
  const live = providers.filter((p) => p.state(ctx).configured);
  const results = await Promise.all(
    live.map(async (p) => {
      try {
        return await p.fetch(site, ctx);
      } catch {
        return EMPTY_SIGNALS;
      }
    }),
  );
  return mergeSignals(results);
}
