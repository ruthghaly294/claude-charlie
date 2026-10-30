import { listingSchema, type Listing } from "../contract.js";
import { distanceKm, inRadius, type Coordinates } from "./geo.js";
import { facebookListingSchema, type FacebookListing } from "./contract.js";
const words = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[’']/g, "")
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter(
      (word) =>
        word.length > 1 &&
        !new Set(["the", "for", "and", "with", "of", "in"]).has(word),
    )
    .map((word) =>
      word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word,
    ) ?? [];
export function relevantTitle(query: string, title: string): boolean {
  const actual = new Set(words(title));
  return words(query).every((word) => actual.has(word));
}
export function localListings(
  input: readonly FacebookListing[],
  search: {
    query: string;
    latitude: number;
    longitude: number;
    radiusKm: number;
    minPrice?: number;
    maxPrice?: number;
  },
): {
  results: Listing[];
  outsideRadius: number;
  unknownLocation: number;
  unrelated: number;
} {
  const results: Listing[] = [];
  let outsideRadius = 0,
    unknownLocation = 0,
    unrelated = 0;
  const seen = new Set<string>();
  const origin: Coordinates = {
    latitude: search.latitude,
    longitude: search.longitude,
  };
  for (const raw of input) {
    const row = facebookListingSchema.parse(raw);
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    if (row.availability === "sold" || row.availability === "pending") continue;
    if (!relevantTitle(search.query, row.title)) {
      unrelated++;
      continue;
    }
    if (!row.coordinates) {
      unknownLocation++;
      continue;
    }
    if (!inRadius(origin, row.coordinates, search.radiusKm)) {
      outsideRadius++;
      continue;
    }
    if (
      (search.minPrice !== undefined &&
        (!row.price || row.price.value < search.minPrice)) ||
      (search.maxPrice !== undefined &&
        (!row.price || row.price.value > search.maxPrice))
    )
      continue;
    const km = distanceKm(origin, row.coordinates);
    results.push(
      listingSchema.parse({
        position: results.length + 1,
        item_id: row.id,
        listed_at: row.listedAt,
        title: row.title,
        url: row.url,
        image: row.image,
        price: row.price,
        condition: null,
        is_auction: false,
        location: `${row.locationName ?? "Approximate seller location"} · approx. ${km.toFixed(1)} km (straight-line)`,
      }),
    );
  }
  return { results, outsideRadius, unknownLocation, unrelated };
}
