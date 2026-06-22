import type { DB } from "@/db/client";
import { fetchText } from "@/discovery/fetchWithRetry";
import { areaFromSlug, normalisePostcode } from "./postcodes";
import { importListingEnriched, type ListingInput } from "./listings";
import { geocodeWithCache, type GeocodeProvider } from "./geocode";
import { extractListingFields } from "./extraction";
import { isAllowed } from "@/lib/robots";
import { loadSources, matchesSource, type PropertySource } from "./sources";
import { repairExtractionCached, type ExtractClient, type ExtractedFields } from "./llmExtract";

export { extractListingFields as extractListing } from "./extraction";
export type { PropertySource as AgentConfig } from "./sources";
export { DEFAULT_SOURCES as AGENTS, loadSources, matchesSource } from "./sources";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type ScrapeOptions = {
  fetchImpl?: typeof fetch;
  max?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** DB for the LLM-repair cache; repair is skipped without it */
  db?: DB;
  /** Claude client for repairing listings missing postcode/sizeSqm */
  extractClient?: ExtractClient | null;
  /** whether to attempt LLM repair for listings missing postcode/sizeSqm (default true) */
  llmRepair?: boolean;
  /** cap on LLM repair calls per scrapeAgent run (default 25) */
  llmMaxPagesPerRun?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** True if the deterministic extraction is missing fields the LLM repair can fill. */
function needsRepair(listing: ListingInput): boolean {
  return !listing.postcode || !listing.sizeSqm;
}

/** Fill only the fields `listing` is missing from `repaired`; never overwrite existing values. */
function mergeRepaired(listing: ListingInput, repaired: ExtractedFields): ListingInput {
  return {
    ...listing,
    address: listing.address || repaired.address || listing.address,
    postcode: listing.postcode || (repaired.postcode ? normalisePostcode(repaired.postcode) : listing.postcode),
    beds: listing.beds ?? repaired.beds,
    propertyType: listing.propertyType || repaired.propertyType,
    sizeSqm: listing.sizeSqm ?? repaired.sizeSqm,
  };
}

/**
 * Scrape one agent: read its sitemap, keep listing URLs in tracked areas, and
 * fetch each at a polite rate. Capped per run; only East/South Belfast (by URL).
 * Skips any URL robots.txt disallows, and (when `db` + `extractClient` are
 * given) repairs listings missing postcode/sizeSqm via Claude.
 */
export async function scrapeAgent(
  agent: PropertySource,
  opts: ScrapeOptions = {},
): Promise<ListingInput[]> {
  const {
    fetchImpl,
    max = 30,
    delayMs = 500,
    sleep = defaultSleep,
    db,
    extractClient,
    llmRepair = true,
    llmMaxPagesPerRun = 25,
  } = opts;

  const robotsCache = new Map<string, string | null>();
  const robotsOpts = { fetchImpl, cache: robotsCache };

  if (!(await isAllowed(agent.sitemapUrl, UA, robotsOpts))) return [];

  const xml = await fetchText(
    agent.sitemapUrl,
    { headers: { "user-agent": UA } },
    { fetchImpl },
  );
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);
  const listingUrls = urls
    .filter((u) => matchesSource(agent, u) && areaFromSlug(u) !== "other")
    .slice(0, max);

  const out: ListingInput[] = [];
  let repairsUsed = 0;
  for (let i = 0; i < listingUrls.length; i++) {
    try {
      const url = listingUrls[i]!;
      if (await isAllowed(url, UA, robotsOpts)) {
        const html = await fetchText(
          url,
          { headers: { "user-agent": UA } },
          { fetchImpl },
        );
        let listing = extractListingFields(html, url, agent.key);
        if (listing && db && llmRepair && needsRepair(listing) && repairsUsed < llmMaxPagesPerRun) {
          repairsUsed++;
          const repaired = await repairExtractionCached(db, html, url, {
            client: extractClient ?? undefined,
          });
          if (repaired) listing = mergeRepaired(listing, repaired);
        }
        if (listing) out.push(listing);
      }
    } catch {
      /* skip a failed page, keep going */
    }
    if (i < listingUrls.length - 1 && delayMs > 0) await sleep(delayMs);
  }
  return out;
}

export type ScrapeSummary = {
  agent: string;
  found: number;
  imported: number;
  geocoded: number;
  /** ids of the listings imported this run (input to changeDetect's diff) */
  listingIds: string[];
};

export type ScrapeAllOptions = ScrapeOptions & {
  /** override the agent set (tests) */
  agents?: PropertySource[];
  /** geocode address → postcode/coords for precise valuation (default true) */
  geocode?: boolean;
  /** delay between live geocoder hits (Nominatim ≤1/sec) */
  geocodeDelayMs?: number;
  /** which geocode providers geocodeWithCache may use, in order */
  geocodeProviders?: GeocodeProvider[];
};

/**
 * Scrape every registered agent, geocode each listing's address to a full
 * postcode (→ precise LPS valuation + accurate map position), then import
 * (value + dedupe + track). Geocoding is cached, so repeat runs are cheap.
 */
export async function scrapeAllAgents(
  db: DB,
  opts: ScrapeAllOptions = {},
): Promise<ScrapeSummary[]> {
  const {
    agents = loadSources(),
    geocode = true,
    geocodeDelayMs = 1100,
    geocodeProviders,
    sleep = defaultSleep,
    fetchImpl,
  } = opts;

  const summaries: ScrapeSummary[] = [];
  for (const agent of agents) {
    const listings = await scrapeAgent(agent, { ...opts, db });
    let geocoded = 0;
    const listingIds: string[] = [];
    for (const l of listings) {
      if (geocode && !l.postcode && l.address) {
        const geo = await geocodeWithCache(
          db,
          `${l.address}, Belfast, Northern Ireland`,
          { fetchImpl, providers: geocodeProviders },
        );
        if (geo?.postcode) {
          l.postcode = geo.postcode;
          l.lat = geo.lat ?? undefined;
          l.lng = geo.lng ?? undefined;
          geocoded++;
        }
        if (geocodeDelayMs > 0) await sleep(geocodeDelayMs);
      }
      const imported = await importListingEnriched(db, l, { fetchImpl });
      listingIds.push(imported.id);
    }
    summaries.push({
      agent: agent.key,
      found: listings.length,
      imported: listings.length,
      geocoded,
      listingIds,
    });
  }
  return summaries;
}
