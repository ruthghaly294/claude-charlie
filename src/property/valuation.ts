import { normalisePostcode } from "./postcodes";

/** Minimal RFC4180 CSV parser (handles quoted fields, embedded commas/quotes/newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? "").trim() !== "");
}

export type PostcodeValueRow = {
  postcode: string;
  longitude: number;
  latitude: number;
  nProperties: number;
  meanVal: number;
  meanSize: number;
  meanPpsqm: number;
  ppsqmDelta: number;
};

/** Parse the ppsqm map CSV (Postcode,longitude,latitude,n_properties,mean_val,mean_size,mean_price_per_sq_m,ppsqm_delta,...). */
export function parsePpsqmCsv(text: string): PostcodeValueRow[] {
  const rows = parseCsv(text);
  const out: PostcodeValueRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (!r[0]) continue;
    out.push({
      postcode: normalisePostcode(r[0]),
      longitude: Number(r[1]) || 0,
      latitude: Number(r[2]) || 0,
      nProperties: Number(r[3]) || 0,
      meanVal: Number(r[4]) || 0,
      meanSize: Number(r[5]) || 0,
      meanPpsqm: Number(r[6]) || 0,
      ppsqmDelta: Number(r[7]) || 0,
    });
  }
  return out;
}

/** Parse the calculator coefficients CSV (coef,value_mean,...) into rows. */
export function parseCoefsCsv(text: string): { coef: string; valueMean: number }[] {
  const rows = parseCsv(text);
  const out: { coef: string; valueMean: number }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (!r[0]) continue;
    out.push({ coef: r[0].trim(), valueMean: Number(r[1]) || 0 });
  }
  return out;
}

export type PropertyFeatures = {
  postcode: string;
  sizeSqm: number;
  hasGarage?: boolean;
  hasGarden?: boolean;
};

/**
 * Estimate a property's fair value using the nihousepricemap calculator model:
 * predicted £/m² = postcode base + size adjustments (+garage/+garden), then × size.
 * Returns null if the postcode isn't in the coefficient set (caller can fall back
 * to the postcode mean £/m²). Coef keys are full postcodes plus the feature names.
 */
export function estimatePrice(
  coefs: Map<string, number>,
  f: PropertyFeatures,
): number | null {
  if (f.sizeSqm <= 0) return null;
  const base = coefs.get(normalisePostcode(f.postcode));
  if (base === undefined) return null;

  let ppsqm = base;
  if (f.sizeSqm < 60) ppsqm += coefs.get("area_lt_60_01") ?? 0;
  ppsqm += (coefs.get("area_m2") ?? 0) * f.sizeSqm;
  ppsqm += (coefs.get("area_squared") ?? 0) * f.sizeSqm * f.sizeSqm;
  if (f.hasGarage) ppsqm += coefs.get("has_garage_01") ?? 0;
  if (f.hasGarden) ppsqm += coefs.get("has_garden_01") ?? 0;

  return Math.max(0, Math.round(ppsqm * f.sizeSqm));
}

/** Simple fallback when no calculator coef exists: postcode mean £/m² × size. */
export function estimateFromPpsqm(meanPpsqm: number, sizeSqm: number): number | null {
  if (meanPpsqm <= 0 || sizeSqm <= 0) return null;
  return Math.round(meanPpsqm * sizeSqm);
}

/** Rough floor-area (m²) by property type — base + per-bedroom. NI listings
 * almost never publish size, so this lets us value like-for-like (a 2-bed flat
 * as a 2-bed flat) instead of against the postcode average. Approximate. */
const SIZE_MODEL: Record<string, { base: number; perBed: number }> = {
  apartment: { base: 30, perBed: 18 },
  flat: { base: 30, perBed: 18 },
  terrace: { base: 40, perBed: 15 },
  townhouse: { base: 40, perBed: 18 },
  semi: { base: 35, perBed: 20 },
  detached: { base: 30, perBed: 31 },
  bungalow: { base: 25, perBed: 25 },
  house: { base: 35, perBed: 20 },
};

function typeKey(propertyType: string): string {
  const t = propertyType.toLowerCase();
  for (const k of Object.keys(SIZE_MODEL)) if (t.includes(k)) return k;
  if (t.includes("maisonette") || t.includes("duplex")) return "apartment";
  return "house";
}

/** Estimate floor area from property type + bedroom count (null if no beds). */
export function estimateSizeSqm(
  propertyType: string,
  beds: number | undefined,
): number | null {
  if (!beds || beds <= 0) return null;
  const { base, perBed } = SIZE_MODEL[typeKey(propertyType)]!;
  return Math.min(400, Math.max(35, Math.round(base + perBed * beds)));
}

export type DealMetrics = { dealPct: number; dealScore: number };

/**
 * How good a buy is the asking price vs fair value. dealPct > 0 = priced BELOW
 * fair value (an opportunity); < 0 = above. dealScore is dealPct rounded, for ranking.
 */
export function dealMetrics(asking: number, fairValue: number): DealMetrics {
  if (fairValue <= 0 || asking <= 0) return { dealPct: 0, dealScore: 0 };
  const dealPct = ((fairValue - asking) / fairValue) * 100;
  return {
    dealPct: Math.round(dealPct * 10) / 10,
    dealScore: Math.round(dealPct),
  };
}
