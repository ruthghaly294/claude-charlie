import type { ListingInput } from "./listings";
import { normalisePostcode } from "./postcodes";

const ANCHOR_RE = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const POSTCODE_RE = /\bBT\d{1,2}\s*\d[A-Z]{2}\b/i;
const PRICE_RE = /£\s*([\d,]{4,})/;
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

/**
 * Parse a forwarded PropertyPal saved-search alert email (HTML) into listings.
 * For each listing link, reads the card region up to the next link for the
 * price / beds / postcode / size. Listings without a price are skipped (we
 * can't value or rank them). Postcode/size are best-effort — emails often omit
 * them, in which case the listing is still tracked and you can fill those in.
 */
export function parsePropertyPalEmail(html: string): ListingInput[] {
  const anchors: { href: string; text: string; index: number }[] = [];
  for (const m of html.matchAll(ANCHOR_RE)) {
    anchors.push({ href: m[1]!, text: m[2]!, index: m.index ?? 0 });
  }

  const out: ListingInput[] = [];
  const seen = new Set<string>();

  anchors.forEach((a, i) => {
    if (!isListingHref(a.href)) return;
    const url = unwrapUrl(a.href);
    if (seen.has(url)) return;

    const regionEnd = anchors[i + 1]?.index ?? Math.min(html.length, a.index + 2000);
    const region = stripTags(html.slice(a.index, regionEnd));
    const priceM = region.match(PRICE_RE);
    if (!priceM) return; // no price → can't value/rank
    const askingPrice = Number(priceM[1]!.replace(/,/g, ""));
    if (!askingPrice) return;

    seen.add(url);
    const pcM = region.match(POSTCODE_RE);
    const bedsM = region.match(BEDS_RE);
    const sizeM = region.match(SIZE_RE);
    const address = stripTags(a.text) || region.slice(0, 80);

    out.push({
      source: "propertypal",
      url,
      address,
      postcode: pcM ? normalisePostcode(pcM[0]) : "",
      askingPrice,
      beds: bedsM ? Number(bedsM[1]) : undefined,
      sizeSqm: sizeM ? Number(sizeM[1]!.replace(/,/g, "")) : undefined,
    });
  });

  return out;
}
