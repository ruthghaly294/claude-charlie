import type { DB } from "@/db/client";
import { fetchText } from "@/discovery/fetchWithRetry";
import { areaFromSlug, normalisePostcode } from "./postcodes";
import { importListing, type ListingInput } from "./listings";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const POSTCODE_RE = /\bBT\d{1,2}\s*\d[A-Z]{2}\b/i;
const BEDS_RE = /(\d+)\s*(?:bed|bedroom)/i;
const PRICE_KW_RE =
  /(?:offers over|offers around|offers in region of|asking price|guide price|fixed price|price)[^£\d]{0,14}£?\s*([\d,]{4,})/i;
const PRICE_ANY_RE = /£\s*([\d,]{4,})/g;
const TITLE_RE = /<meta property="og:title" content="([^"]*)"/i;
const TYPE_RE = /\b(apartment|flat|house|bungalow|villa|townhouse|cottage|duplex|maisonette|site)\b/i;

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&pound;|&#163;/g, "£")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Address from the last meaningful URL segment (the listing slug). */
function addressFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const slug = [...parts]
      .reverse()
      .find((p) => /[a-z]/i.test(p) && !/^tr[lt]|^tre|^[0-9a-f]{6,}$/i.test(p));
    return slug ? titleCase(slug) : titleCase(parts[parts.length - 1] ?? "");
  } catch {
    return "";
  }
}

function pickPrice(text: string): number | null {
  const kw = text.match(PRICE_KW_RE);
  if (kw) {
    const n = Number(kw[1]!.replace(/,/g, ""));
    if (n >= 20000) return n;
  }
  for (const m of text.matchAll(PRICE_ANY_RE)) {
    const n = Number(m[1]!.replace(/,/g, ""));
    if (n >= 20000) return n; // skip fees/stamp-duty small numbers
  }
  return null;
}

/**
 * Extract a listing from an estate-agent property page. Generic across CMSs:
 * price via a price-keyword (then any £≥20k), address from the URL slug, area
 * from the URL, beds/type/postcode best-effort. Returns null if no price.
 */
export function extractListing(
  html: string,
  url: string,
  source: string,
): ListingInput | null {
  const text = stripTags(html);
  const price = pickPrice(text);
  if (price === null) return null;

  const title = html.match(TITLE_RE)?.[1]?.trim();
  const pcM = (title ?? "").match(POSTCODE_RE) ?? text.match(POSTCODE_RE);
  const bedsM = text.match(BEDS_RE);
  const typeM = (title ?? text).match(TYPE_RE);

  return {
    source,
    url,
    address: addressFromUrl(url),
    postcode: pcM ? normalisePostcode(pcM[0]) : "",
    area: areaFromSlug(url),
    askingPrice: price,
    beds: bedsM ? Number(bedsM[1]) : undefined,
    propertyType: typeM ? typeM[1]!.toLowerCase() : "",
  };
}

export type AgentConfig = {
  key: string;
  name: string;
  sitemapUrl: string;
  /** identifies a listing (vs article/branch) URL in the sitemap */
  listingRe: RegExp;
};

/**
 * Registry of NI estate agents whose own sites are robots-permitted and not
 * behind an anti-bot wall. Verified June 2026: both allow `User-agent: *`.
 * (Add agents here; the framework handles the rest.)
 */
export const AGENTS: AgentConfig[] = [
  {
    key: "templeton-robinson",
    name: "Templeton Robinson",
    sitemapUrl: "https://www.templetonrobinson.com/site_map_xml.asp",
    listingRe: /\/property\/[^/]+\/[^/]+\/[^/]+\/?$/i,
  },
  {
    key: "simon-brien",
    name: "Simon Brien",
    sitemapUrl: "https://www.simonbrien.com/sbr/sitemap.xml",
    listingRe: /\/buy\/[^/]+\/[^/]+\/[^/]+/i,
  },
];

export type ScrapeOptions = {
  fetchImpl?: typeof fetch;
  max?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Scrape one agent: read its sitemap, keep listing URLs in tracked areas, and
 * fetch each at a polite rate. Capped per run; only East/South Belfast (by URL).
 */
export async function scrapeAgent(
  agent: AgentConfig,
  opts: ScrapeOptions = {},
): Promise<ListingInput[]> {
  const {
    fetchImpl,
    max = 30,
    delayMs = 500,
    sleep = defaultSleep,
  } = opts;

  const xml = await fetchText(
    agent.sitemapUrl,
    { headers: { "user-agent": UA } },
    { fetchImpl },
  );
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);
  const listingUrls = urls
    .filter((u) => agent.listingRe.test(u) && areaFromSlug(u) !== "other")
    .slice(0, max);

  const out: ListingInput[] = [];
  for (let i = 0; i < listingUrls.length; i++) {
    try {
      const html = await fetchText(
        listingUrls[i]!,
        { headers: { "user-agent": UA } },
        { fetchImpl },
      );
      const listing = extractListing(html, listingUrls[i]!, agent.key);
      if (listing) out.push(listing);
    } catch {
      /* skip a failed page, keep going */
    }
    if (i < listingUrls.length - 1 && delayMs > 0) await sleep(delayMs);
  }
  return out;
}

export type ScrapeSummary = { agent: string; found: number; imported: number };

/** Scrape every registered agent and import (value + dedupe + track) the results. */
export async function scrapeAllAgents(
  db: DB,
  opts: ScrapeOptions = {},
): Promise<ScrapeSummary[]> {
  const summaries: ScrapeSummary[] = [];
  for (const agent of AGENTS) {
    const listings = await scrapeAgent(agent, opts);
    for (const l of listings) importListing(db, l);
    summaries.push({
      agent: agent.key,
      found: listings.length,
      imported: listings.length,
    });
  }
  return summaries;
}
