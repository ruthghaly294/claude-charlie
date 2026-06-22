import { areaFromSlug, normalisePostcode } from "./postcodes";
import type { ListingInput } from "./listings";

const POSTCODE_RE = /\bBT\d{1,2}\s*\d[A-Z]{2}\b/i;
const BEDS_RE = /(\d+)\s*(?:bed|bedroom)/i;
const PRICE_KW_RE =
  /(?:offers over|offers around|offers in region of|asking price|guide price|fixed price|price)[^£\d]{0,14}£?\s*([\d,]{4,})/i;
const PRICE_ANY_RE = /£\s*([\d,]{4,})/g;
const TITLE_RE = /<meta property="og:title" content="([^"]*)"/i;
const TYPE_RE = /\b(apartment|flat|house|bungalow|villa|townhouse|cottage|duplex|maisonette|site)\b/i;
const ROAD_RE =
  /\b(road|avenue|park|gardens|drive|crescent|mews|square|lane|street|grove|terrace|close|heights|manor|view|walk|court|place|hill|way)\b/i;

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

/** A fuller, geocodable address from og:title, handling the two common formats. */
function addressFromTitle(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  // pipe-delimited (e.g. Simon Brien): pick the segment that looks like an address
  const segs = t.split("|").map((s) => s.trim());
  const seg = segs.find(
    (s) => (/\d/.test(s) || ROAD_RE.test(s)) && !/for sale|for rent|to let/i.test(s),
  );
  if (seg && segs.length > 1) return seg.replace(/,\s*$/, "");
  // no pipes (e.g. Templeton Robinson): cut the "… Property for sale at X" suffix
  const cut = t.split(/\b(?:property )?(?:for sale|for rent|to let)\b/i)[0]!;
  return cut.replace(/\bProperty\b\s*$/i, "").replace(/[,\s]+$/, "").trim();
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

export type JsonLdFields = {
  address?: string;
  postcode?: string;
  askingPrice?: number;
  beds?: number;
  propertyType?: string;
  sizeSqm?: number;
};

const SQFT_TO_SQM = 0.092903;
const REAL_ESTATE_TYPES = new Set([
  "product",
  "offer",
  "realestatelisting",
  "house",
  "apartment",
  "singlefamilyresidence",
  "residence",
  "place",
]);
const GENERIC_TYPES = new Set(["product", "offer", "place"]);

const JSONLD_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function flattenJsonLd(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const item of node) flattenJsonLd(item, out);
    return out;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj["@graph"])) {
      flattenJsonLd(obj["@graph"], out);
    } else {
      out.push(obj);
    }
  }
  return out;
}

function priceFromNode(node: Record<string, unknown>): number | null {
  const offersRaw = node.offers;
  const offers = Array.isArray(offersRaw) ? offersRaw[0] : offersRaw;
  const raw =
    (offers && typeof offers === "object" ? (offers as Record<string, unknown>).price : undefined) ??
    node.price;
  if (raw === undefined || raw === null) return null;
  const n = Number(String(raw).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function addressFromNode(node: Record<string, unknown>): { address?: string; postcode?: string } {
  const addr = node.address;
  if (!addr || typeof addr !== "object") return {};
  const a = addr as Record<string, unknown>;
  const parts = [a.streetAddress, a.addressLocality, a.addressRegion]
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim());
  const postcode =
    typeof a.postalCode === "string" && a.postalCode.trim()
      ? normalisePostcode(a.postalCode)
      : undefined;
  return { address: parts.length > 0 ? parts.join(", ") : undefined, postcode };
}

function sizeSqmFromNode(node: Record<string, unknown>): number | undefined {
  const fs = node.floorSize;
  if (!fs || typeof fs !== "object") return undefined;
  const f = fs as Record<string, unknown>;
  const value = Number(f.value);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const unit = typeof f.unitCode === "string" ? f.unitCode.toUpperCase() : "";
  const sqm = unit === "FTK" ? value * SQFT_TO_SQM : value;
  return Math.round(sqm);
}

function bedsFromNode(node: Record<string, unknown>): number | undefined {
  const raw = node.numberOfBedroomsTotal ?? node.numberOfRooms;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function propertyTypeFromNode(node: Record<string, unknown>): string | undefined {
  const type = node["@type"];
  const t = Array.isArray(type) ? type[0] : type;
  if (typeof t !== "string") return undefined;
  const lower = t.toLowerCase();
  if (!REAL_ESTATE_TYPES.has(lower) || GENERIC_TYPES.has(lower)) return undefined;
  return lower;
}

function fieldsFromNode(node: Record<string, unknown>): JsonLdFields | null {
  const askingPrice = priceFromNode(node);
  const { address, postcode } = addressFromNode(node);
  const sizeSqm = sizeSqmFromNode(node);
  const beds = bedsFromNode(node);
  const propertyType = propertyTypeFromNode(node);

  if (askingPrice === null && !address && !postcode && sizeSqm === undefined) {
    return null;
  }

  return {
    ...(address ? { address } : {}),
    ...(postcode ? { postcode } : {}),
    ...(askingPrice !== null ? { askingPrice } : {}),
    ...(beds !== undefined ? { beds } : {}),
    ...(propertyType ? { propertyType } : {}),
    ...(sizeSqm !== undefined ? { sizeSqm } : {}),
  };
}

/** Pull listing fields from the page's schema.org JSON-LD (Product/RealEstateListing), if any. */
export function extractJsonLd(html: string): JsonLdFields | null {
  for (const m of html.matchAll(JSONLD_RE)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]!.trim());
    } catch {
      continue;
    }
    for (const node of flattenJsonLd(parsed)) {
      const fields = fieldsFromNode(node);
      if (fields) return fields;
    }
  }
  return null;
}

/**
 * Extract a listing from an estate-agent property page. Generic across CMSs.
 * schema.org JSON-LD (Product/RealEstateListing), when present, wins per-field;
 * otherwise: price via a price-keyword (then any £≥20k), address from og:title
 * or the URL slug, area from the URL, beds/type/postcode best-effort. Returns
 * null for lettings pages or if no price can be found.
 */
export function extractListingFields(
  html: string,
  url: string,
  source: string,
): ListingInput | null {
  const title = html.match(TITLE_RE)?.[1]?.trim();
  // skip lettings — we only value sales
  if (/\bfor rent\b|\bto let\b|\bper month\b|\bp(?:c|)m\b/i.test(title ?? "")) {
    return null;
  }

  const jsonLd = extractJsonLd(html);
  const text = stripTags(html);
  const askingPrice = jsonLd?.askingPrice ?? pickPrice(text);
  if (askingPrice === null || askingPrice === undefined) return null;

  const pcM = (title ?? "").match(POSTCODE_RE);
  const bedsM = text.match(BEDS_RE);
  const typeM = (title ?? text).match(TYPE_RE);
  const regexAddress = (title && addressFromTitle(title)) || addressFromUrl(url);

  return {
    source,
    url,
    address: jsonLd?.address || regexAddress || addressFromUrl(url),
    postcode: jsonLd?.postcode || (pcM ? normalisePostcode(pcM[0]) : ""),
    area: areaFromSlug(url),
    askingPrice,
    beds: jsonLd?.beds ?? (bedsM ? Number(bedsM[1]) : undefined),
    propertyType: jsonLd?.propertyType || (typeM ? typeM[1]!.toLowerCase() : ""),
    sizeSqm: jsonLd?.sizeSqm,
  };
}
