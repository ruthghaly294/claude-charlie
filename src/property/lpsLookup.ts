import type { DB } from "@/db/client";
import { lpsProperties, type LpsProperty } from "@/db/schema";
import { fetchText } from "@/discovery/fetchWithRetry";
import { normalisePostcode, outwardCode } from "./postcodes";

/**
 * Per-address property facts from the public LPS valuation list
 * (valuationservices.finance-ni.gov.uk). This gives us the REAL floor area,
 * garage and garden for any rated NI property, so valuations stop relying on
 * size estimates. The capital value is also captured, but it is the 1 Jan 2005
 * rating valuation — it is stored as context only and never used directly as a
 * price (current prices come from the index-uplifted £/m² reference data).
 */

const BASE = "https://valuationservices.finance-ni.gov.uk";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type LpsSearchRow = {
  propertyId: string;
  fullAddress: string;
  capitalValue: number | null;
};

/** "£165,000" / "£165,000.00" → 165000; "N/A"/empty → null. */
export function parseCapitalValue(s: string | null | undefined): number | null {
  if (!s) return null;
  const digits = s.replace(/&#?\w+;/g, "").replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Parse the GetResultsByPostcode JSON into search rows. */
export function parseSearchResults(json: string): LpsSearchRow[] {
  let raw: {
    propertyId?: string | number;
    fullAddress?: string;
    capitalValue?: string;
  }[];
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r.propertyId != null && r.fullAddress)
    .map((r) => ({
      propertyId: String(r.propertyId),
      fullAddress: r.fullAddress!,
      capitalValue: parseCapitalValue(r.capitalValue),
    }));
}

export type LpsDetail = {
  sizeSqm: number | null;
  hasGarage: boolean;
  hasGarden: boolean;
  capitalValue: number | null;
  description: string;
};

/** Extract size/garage/garden/capital value from a Property/Details page. */
export function parseDetailHtml(html: string): LpsDetail {
  const cell = (label: RegExp): string | null => {
    const m = html.match(
      new RegExp(label.source + String.raw`[\s\S]{0,600}?<td[^>]*>([^<]*)</td>`),
    );
    return m ? m[1]!.trim() : null;
  };
  const sizeText = cell(/Property size<\/th>/) ?? "";
  const sizeM = sizeText.match(/([\d.]+)\s*m/);
  const size = sizeM ? Number(sizeM[1]) : null;
  const garage = (cell(/Garage<\/th>/) ?? "").toLowerCase() === "yes";
  const cv = parseCapitalValue(cell(/Capital Value \(non.exempt\)/));
  const description = (cell(/Description\s*</) ?? "").toLowerCase();
  return {
    sizeSqm: size && size > 0 ? size : null,
    hasGarage: garage,
    hasGarden: description.includes("garden"),
    capitalValue: cv,
    description,
  };
}

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The "17 Gilnahirk Walk" part of a listing address (first numbered segment). */
export function numberedSegment(address: string): string | null {
  const seg = address
    .split(",")
    .map(normalise)
    .find((s) => /^\d/.test(s));
  return seg ?? null;
}

/** Postcode at the end of an LPS full address ("… Belfast BT5 7DS"), if any. */
export function postcodeFromLpsAddress(fullAddress: string): string | null {
  const m = fullAddress.toUpperCase().match(/(BT\d{1,2}\s*\d[A-Z]{2})\s*$/);
  return m ? normalisePostcode(m[1]!) : null;
}

/**
 * Asking price vs 2005 capital value plausibility band. NI prices have ranged
 * from roughly parity with the 2005 valuation (2013 trough) to ~2.5× today;
 * correctly matched listings cluster at 1.2–2.4×. Outside 0.8–4× the match is
 * almost certainly a different property that shares the house number + street
 * name (they're common across NI towns), so we reject it.
 */
const ASKING_TO_CV_MIN = 0.8;
const ASKING_TO_CV_MAX = 4.0;

function plausibleCv(askingPrice: number | undefined, cv: number | null): boolean {
  if (!askingPrice || !cv) return true; // nothing to check against
  const ratio = askingPrice / cv;
  return ratio >= ASKING_TO_CV_MIN && ratio <= ASKING_TO_CV_MAX;
}

/**
 * Match a listing address against LPS search rows. Listing addresses look like
 * "112 Gilnahirk Road, Belfast"; LPS rows like "112 Gilnahirk Road, Tullycarnet,
 * Belfast BT5 7DL" — so the listing's numbered segment must be a prefix of the
 * LPS address. Candidates whose 2005 capital value is implausible against the
 * asking price are rejected (same number + street elsewhere in NI). Ties go to
 * domestic rows (with a capital value), then rows in the listing's postcode
 * district, then rows mentioning the listing's town.
 */
export function matchAddress(
  rows: LpsSearchRow[],
  address: string,
  opts: { postcode?: string; askingPrice?: number } = {},
): LpsSearchRow | null {
  const seg = numberedSegment(address);
  if (!seg) return null;
  const town = address
    .split(",")
    .map(normalise)
    .filter((s) => s && !/\d/.test(s))
    .pop();
  const district = opts.postcode ? outwardCode(opts.postcode) : "";

  const score = (r: LpsSearchRow): number => {
    const full = normalise(r.fullAddress);
    if (full !== seg && !full.startsWith(seg + " ")) return -1;
    if (!plausibleCv(opts.askingPrice, r.capitalValue)) return -1;
    let s = 0;
    if (r.capitalValue !== null) s += 4;
    if (district && postcodeFromLpsAddress(r.fullAddress)?.startsWith(district))
      s += 2;
    if (town && full.includes(town)) s += 1;
    return s;
  };
  let best: LpsSearchRow | null = null;
  let bestScore = -1;
  for (const r of rows) {
    const s = score(r);
    if (s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  return bestScore >= 0 ? best : null;
}

export type LookupOpts = {
  fetchImpl?: typeof fetch;
  now?: () => string;
};

async function searchByPostcode(
  postcode: string,
  opts: LookupOpts,
): Promise<LpsSearchRow[]> {
  const body = new URLSearchParams({ postcode });
  const json = await fetchText(
    `${BASE}/Property/GetResultsByPostcode`,
    {
      method: "POST",
      headers: {
        "user-agent": UA,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
    { fetchImpl: opts.fetchImpl },
  );
  return parseSearchResults(json);
}

async function searchByStreet(
  address: string,
  opts: LookupOpts,
): Promise<LpsSearchRow[]> {
  const seg = numberedSegment(address);
  if (!seg) return [];
  const m = seg.match(/^([\d/]+[a-z]?)\s+(.{3,})$/);
  if (!m) return [];
  const body = new URLSearchParams({ propertyNumber: m[1]!, street: m[2]! });
  const json = await fetchText(
    `${BASE}/Property/GetResultsByAdvanced`,
    {
      method: "POST",
      headers: {
        "user-agent": UA,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
    { fetchImpl: opts.fetchImpl },
  );
  return parseSearchResults(json);
}

async function fetchDetail(
  propertyId: string,
  opts: LookupOpts,
): Promise<LpsDetail> {
  const html = await fetchText(
    `${BASE}/Property/Details?propertyId=${encodeURIComponent(propertyId)}`,
    { headers: { "user-agent": UA } },
    { fetchImpl: opts.fetchImpl },
  );
  return parseDetailHtml(html);
}

const toSearchRow = (c: LpsProperty): LpsSearchRow => ({
  propertyId: c.propertyId,
  fullAddress: c.fullAddress,
  capitalValue: c.capitalValue,
});

/**
 * Find the LPS record for one address: cached rows first, then a live postcode
 * search (when we have a postcode), then a street-name search. The street
 * search works with NO postcode at all and reveals the property's TRUE
 * postcode from the LPS full address — listing postcodes are often geocoder
 * guesses, and many listings have none. Results are cached in lps_properties
 * so re-imports and re-valuations never re-hit the service.
 */
export async function lookupLpsProperty(
  db: DB,
  input: { postcode?: string; address: string; askingPrice?: number },
  opts: LookupOpts = {},
): Promise<LpsProperty | null> {
  const pc = input.postcode ? normalisePostcode(input.postcode) : "";
  if (!input.address) return null;
  const now = opts.now ?? (() => new Date().toISOString());
  const matchOpts = { postcode: pc || undefined, askingPrice: input.askingPrice };

  // cache: same district is enough — the listing postcode may be wrong.
  // With no postcode, match across the whole cache (town + CV scoring decide).
  const district = outwardCode(pc);
  const cached = db
    .select()
    .from(lpsProperties)
    .all()
    .filter((c) => !district || outwardCode(c.postcode) === district);
  const cachedHit = matchAddress(cached.map(toSearchRow), input.address, matchOpts);
  if (cachedHit) {
    return cached.find((c) => c.propertyId === cachedHit.propertyId)!;
  }

  let hit = pc
    ? matchAddress(await searchByPostcode(pc, opts), input.address, matchOpts)
    : null;
  hit ??= matchAddress(
    await searchByStreet(input.address, opts),
    input.address,
    matchOpts,
  );
  if (!hit) return null;

  const detail = await fetchDetail(hit.propertyId, opts);
  const row: LpsProperty = {
    propertyId: hit.propertyId,
    postcode: postcodeFromLpsAddress(hit.fullAddress) ?? pc,
    fullAddress: hit.fullAddress,
    capitalValue: detail.capitalValue ?? hit.capitalValue,
    sizeSqm: detail.sizeSqm,
    hasGarage: detail.hasGarage ? 1 : 0,
    hasGarden: detail.hasGarden ? 1 : 0,
    description: detail.description,
    fetchedAt: now(),
  };
  db.insert(lpsProperties)
    .values(row)
    .onConflictDoUpdate({ target: lpsProperties.propertyId, set: row })
    .run();
  return row;
}

export type LpsEnrichment = {
  sizeSqm?: number;
  hasGarage?: boolean;
  hasGarden?: boolean;
  lpsPropertyId?: string;
  lpsCapitalValue?: number;
  sizeSource?: "listing" | "lps";
  /** the property's true postcode, when LPS disagrees with the listing's */
  postcode?: string;
};

/**
 * LPS facts to merge into a listing before valuing it: real floor area (unless
 * the listing already published one), garage/garden flags, the true postcode
 * (listing postcodes are often geocoder guesses), and the LPS record id + 2005
 * capital value for context. Listing-provided size/features always win.
 */
export async function lpsEnrichment(
  db: DB,
  input: {
    postcode?: string;
    address: string;
    sizeSqm?: number;
    hasGarage?: boolean;
    hasGarden?: boolean;
    askingPrice?: number;
  },
  opts: LookupOpts = {},
): Promise<LpsEnrichment> {
  const listingSize = input.sizeSqm && input.sizeSqm > 0 ? input.sizeSqm : undefined;
  let lps: LpsProperty | null = null;
  try {
    lps = await lookupLpsProperty(
      db,
      {
        postcode: input.postcode,
        address: input.address,
        askingPrice: input.askingPrice,
      },
      opts,
    );
  } catch {
    lps = null; // enrichment is best-effort; valuation falls back to estimates
  }
  if (!lps) return listingSize ? { sizeSource: "listing" } : {};
  const lpsSize = lps.sizeSqm && lps.sizeSqm > 0 ? lps.sizeSqm : undefined;
  const pc = input.postcode ? normalisePostcode(input.postcode) : "";
  return {
    sizeSqm: listingSize ?? lpsSize,
    hasGarage: input.hasGarage ?? lps.hasGarage === 1,
    hasGarden: input.hasGarden ?? lps.hasGarden === 1,
    lpsPropertyId: lps.propertyId,
    lpsCapitalValue: lps.capitalValue ?? undefined,
    sizeSource: listingSize ? "listing" : lpsSize ? "lps" : undefined,
    ...(lps.postcode && lps.postcode !== pc ? { postcode: lps.postcode } : {}),
  };
}

/** How many cached LPS records we hold (dashboard status). */
export function lpsCacheCount(db: DB): number {
  return db.select().from(lpsProperties).all().length;
}
