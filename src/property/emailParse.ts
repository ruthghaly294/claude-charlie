import type { ListingInput } from "./listings";
import { normalisePostcode } from "./postcodes";

const ANCHOR_RE = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const POSTCODE_RE = /\bBT\d{1,2}\s*\d[A-Z]{2}\b/i;
const BEDS_RE = /(\d+)\s*(?:bed|bedroom)/i;
const SIZE_RE = /([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*m|m²|sqm)/i;

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&pound;|&#163;/g, "£")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** PropertyPal often wraps the real URL in a tracking redirect — pull it back out. */
function unwrapUrl(href: string): string {
  try {
    const u = new URL(href);
    // a redirect param pointing at the real listing wins (handles email.propertypal.com/c/redir?u=…)
    for (const v of u.searchParams.values()) {
      const dec = decodeURIComponent(v);
      if (/www\.propertypal\.com\/.+/.test(dec)) return dec.split("?")[0]!;
    }
  } catch {
    /* not an absolute url */
  }
  return href.split("?")[0]!;
}

function isListingHref(href: string): boolean {
  return /propertypal\.com/i.test(href) && !/\/(unsubscribe|account|login|help|contact|privacy|saved-search|email-preferences)/i.test(href);
}

const BARE_URL_RE = /https?:\/\/(?:www\.|email\.)?propertypal\.com\/[^\s"'<>)\]]+/gi;
const PRICE_G = /£\s*([\d,]{4,})/g;

type Candidate = { url: string; text: string; index: number };

/** First (or last) £ amount in a chunk of text. */
function priceIn(text: string, last: boolean): number | null {
  const ms = [...text.matchAll(PRICE_G)];
  if (ms.length === 0) return null;
  const m = last ? ms[ms.length - 1]! : ms[0]!;
  const n = Number(m[1]!.replace(/,/g, ""));
  return n || null;
}

/** Best-effort address from the URL slug, e.g. /12-cregagh-road/84500 → "12 cregagh road". */
function addressFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const slug = [...parts].reverse().find((p) => !/^\d+$/.test(p)) ?? "";
    return slug.replace(/[-_]+/g, " ").trim();
  } catch {
    return "";
  }
}

/**
 * Parse a PropertyPal saved-search alert into listings — accepts the email's
 * HTML *or* the plain text you copied out of it. Collects every listing link
 * (anchored or bare), then reads each card for price / postcode / beds / size:
 * forward from the link first (HTML layout), falling back to the text just
 * before it (plain-text layout, where the price precedes the URL). Listings
 * with no price are skipped; postcode/size are best-effort (emails often omit
 * them — those still import for tracking and value once you add a postcode).
 */
export function parsePropertyPalEmail(input: string): ListingInput[] {
  const cands: Candidate[] = [];
  let anchored = false;
  for (const m of input.matchAll(ANCHOR_RE)) {
    if (isListingHref(m[1]!)) {
      cands.push({ url: unwrapUrl(m[1]!), text: stripTags(m[2]!), index: m.index ?? 0 });
      anchored = true;
    }
  }
  for (const m of input.matchAll(BARE_URL_RE)) {
    const url = unwrapUrl(m[0]!.replace(/[.,);]+$/, ""));
    if (isListingHref(url)) cands.push({ url, text: "", index: m.index ?? 0 });
  }
  cands.sort((a, b) => a.index - b.index);

  const seen = new Set<string>();
  const uniq = cands.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });

  const out: ListingInput[] = [];
  uniq.forEach((c, i) => {
    const prevEnd = i > 0 ? uniq[i - 1]!.index : 0;
    const nextStart = uniq[i + 1]?.index ?? input.length;
    // HTML emails put the price *after* the link (read forward); plain-text
    // layout puts price/details *before* the URL (read the text between the
    // previous listing and this one). Mixing them would steal a neighbour's price.
    let price: number | null;
    let region: string;
    if (anchored) {
      region = stripTags(input.slice(c.index, nextStart));
      price = priceIn(region, false);
    } else {
      const back = stripTags(input.slice(prevEnd, c.index));
      region = `${back} ${stripTags(input.slice(c.index, nextStart))}`;
      price = priceIn(back, true);
    }
    if (price === null) return;

    const pcM = region.match(POSTCODE_RE);
    const bedsM = region.match(BEDS_RE);
    const sizeM = region.match(SIZE_RE);
    out.push({
      source: "propertypal",
      url: c.url,
      address: c.text || addressFromUrl(c.url) || region.slice(0, 80),
      postcode: pcM ? normalisePostcode(pcM[0]) : "",
      askingPrice: price,
      beds: bedsM ? Number(bedsM[1]) : undefined,
      sizeSqm: sizeM ? Number(sizeM[1]!.replace(/,/g, "")) : undefined,
    });
  });

  return out;
}
