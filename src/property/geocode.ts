import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { geocodeCache } from "@/db/schema";
import { fetchJson } from "@/discovery/fetchWithRetry";
import { normalisePostcode } from "./postcodes";

// Nominatim usage policy: ≤1 req/sec, identify yourself. The scrape pipeline
// rate-limits + caches; this is personal-research volume.
const UA = "decode-property-intel/1.0 (personal property research)";

const nominatimSchema = z.array(
  z.object({
    lat: z.string().optional(),
    lon: z.string().optional(),
    address: z.object({ postcode: z.string().optional() }).optional(),
  }),
);

export type GeoResult = { postcode: string; lat: number | null; lng: number | null };

/** Geocode a free-text address via OpenStreetMap/Nominatim → postcode + coords. */
export async function geocodeAddress(
  query: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GeoResult | null> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1` +
    `&countrycodes=gb&limit=1&q=${encodeURIComponent(query)}`;
  const data = await fetchJson(
    url,
    nominatimSchema,
    { headers: { "user-agent": UA, "accept-language": "en-GB" } },
    { fetchImpl: opts.fetchImpl },
  );
  const hit = data[0];
  if (!hit || (!hit.lat && !hit.address?.postcode)) return null;
  return {
    postcode: hit.address?.postcode ? normalisePostcode(hit.address.postcode) : "",
    lat: hit.lat ? Number(hit.lat) : null,
    lng: hit.lon ? Number(hit.lon) : null,
  };
}

/**
 * Geocode with a DB cache: never queries Nominatim twice for the same address.
 * Misses are cached too (empty postcode + null coords) so failures don't retry
 * on every run. Returns null for a cached miss.
 */
export async function geocodeWithCache(
  db: DB,
  query: string,
  opts: { fetchImpl?: typeof fetch; now?: () => string } = {},
): Promise<GeoResult | null> {
  const key = query.trim().toLowerCase();
  const cached = db
    .select()
    .from(geocodeCache)
    .where(eq(geocodeCache.query, key))
    .get();
  if (cached) {
    if (!cached.postcode && cached.latitude == null) return null;
    return { postcode: cached.postcode, lat: cached.latitude, lng: cached.longitude };
  }

  const result = await geocodeAddress(query, { fetchImpl: opts.fetchImpl });
  const now = opts.now ?? (() => new Date().toISOString());
  db.insert(geocodeCache)
    .values({
      query: key,
      postcode: result?.postcode ?? "",
      latitude: result?.lat ?? null,
      longitude: result?.lng ?? null,
      fetchedAt: now(),
    })
    .onConflictDoNothing()
    .run();
  return result;
}
