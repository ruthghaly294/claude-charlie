import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { postcodeValues, valuationCoefs } from "@/db/schema";
import { fetchText } from "@/discovery/fetchWithRetry";
import { parsePpsqmCsv, parseCoefsCsv } from "./valuation";
import { isTrackedArea, classifyArea } from "./postcodes";

const BASE = "https://www.nihousepricemap.com/static";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type ReferenceSummary = {
  quarter: string;
  postcodes: number;
  coefs: number;
};

/** Read the latest data quarter the map advertises (e.g. "2025_Q3"). */
export async function fetchLatestQuarter(
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const html = await fetchText(
    "https://www.nihousepricemap.com/",
    { headers: { "user-agent": UA } },
    { fetchImpl: opts.fetchImpl },
  );
  const m = html.match(/latest_data_quarter\s*=\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error("could not find latest_data_quarter");
  return m[1]!;
}

/**
 * Ingest the LPS-modelled fair-value reference data (postcode £/m² + calculator
 * coefficients) from nihousepricemap.com into the DB. Only the tracked Belfast
 * postcodes are stored for postcode_values (the map covers all of NI); all
 * coefficients are stored (small). Idempotent — upserts by key.
 */
export async function ingestReference(
  db: DB,
  opts: { fetchImpl?: typeof fetch; quarter?: string; now?: () => string } = {},
): Promise<ReferenceSummary> {
  const fetchImpl = opts.fetchImpl;
  const now = opts.now ?? (() => new Date().toISOString());
  const quarter = opts.quarter ?? (await fetchLatestQuarter({ fetchImpl }));
  const updatedAt = now();

  const get = (file: string) =>
    fetchText(
      `${BASE}/${file}`,
      { headers: { "user-agent": UA } },
      { fetchImpl },
    );

  const [ppsqmCsv, coefsCsv] = await Promise.all([
    get(`ppsqm_nge10_glmmethod_smoothed_alpha3000_${quarter}.csv`),
    get(`calculator_coefs_houses_smoothed_alpha3000_${quarter}.csv`),
  ]);

  const pvRows = parsePpsqmCsv(ppsqmCsv).filter((r) => isTrackedArea(r.postcode));
  for (const r of pvRows) {
    db.insert(postcodeValues)
      .values({ ...r, quarter, updatedAt })
      .onConflictDoUpdate({
        target: postcodeValues.postcode,
        set: { ...r, quarter, updatedAt },
      })
      .run();
  }

  const coefRows = parseCoefsCsv(coefsCsv);
  for (const c of coefRows) {
    db.insert(valuationCoefs)
      .values({ coef: c.coef, valueMean: c.valueMean, updatedAt })
      .onConflictDoUpdate({
        target: valuationCoefs.coef,
        set: { valueMean: c.valueMean, updatedAt },
      })
      .run();
  }

  return { quarter, postcodes: pvRows.length, coefs: coefRows.length };
}

/** Load the calculator coefficients into a Map for estimatePrice. */
export function loadCoefMap(db: DB): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of db.select().from(valuationCoefs).all()) {
    map.set(c.coef, c.valueMean);
  }
  return map;
}

/** Mean £/m² for a postcode (fallback baseline), or undefined. */
export function meanPpsqmFor(db: DB, postcode: string): number | undefined {
  const row = db
    .select()
    .from(postcodeValues)
    .where(eq(postcodeValues.postcode, postcode))
    .get();
  return row?.meanPpsqm;
}

/** Mean property value for a postcode (size-free baseline), or undefined. */
export function meanValFor(db: DB, postcode: string): number | undefined {
  const row = db
    .select()
    .from(postcodeValues)
    .where(eq(postcodeValues.postcode, postcode))
    .get();
  return row?.meanVal;
}

/** Average £/m² across a postcode district (outward code, e.g. "BT5"). */
export function districtPpsqm(db: DB, outward: string): number | undefined {
  if (!outward) return undefined;
  const vals = db
    .select()
    .from(postcodeValues)
    .all()
    .filter((r) => r.postcode.startsWith(outward + " ") && r.meanPpsqm > 0)
    .map((r) => r.meanPpsqm);
  if (vals.length === 0) return undefined;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/** Average mean property value across a tracked area (coarsest baseline). */
export function areaMeanVal(db: DB, area: string): number | undefined {
  const vals = db
    .select()
    .from(postcodeValues)
    .all()
    .filter((r) => classifyArea(r.postcode) === area && r.meanVal > 0)
    .map((r) => r.meanVal);
  if (vals.length === 0) return undefined;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}
