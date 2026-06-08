import { createHash, randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { listings, listingSnapshots, type Listing } from "@/db/schema";
import { classifyArea, normalisePostcode } from "./postcodes";
import {
  estimatePrice,
  estimateFromPpsqm,
  dealMetrics,
} from "./valuation";
import { loadCoefMap, meanPpsqmFor } from "./referenceIngest";

export type ListingInput = {
  id?: string;
  source?: string;
  address: string;
  street?: string;
  postcode: string;
  propertyType?: string;
  beds?: number;
  sizeSqm?: number;
  askingPrice: number;
  url?: string;
  hasGarage?: boolean;
  hasGarden?: boolean;
  status?: "active" | "sstc" | "sold" | "gone";
};

function deriveId(input: ListingInput): string {
  const basis = input.url?.trim() || `${normalisePostcode(input.postcode)}|${input.address}`;
  return `listing:${createHash("sha1").update(basis).digest("hex").slice(0, 16)}`;
}

/** Compute a fair value: calculator model first, postcode-mean £/m² as fallback. */
export function fairValueFor(
  db: DB,
  input: { postcode: string; sizeSqm?: number; hasGarage?: boolean; hasGarden?: boolean },
): number | null {
  if (!input.sizeSqm || input.sizeSqm <= 0) return null;
  const coefs = loadCoefMap(db);
  const modelled = estimatePrice(coefs, {
    postcode: input.postcode,
    sizeSqm: input.sizeSqm,
    hasGarage: input.hasGarage,
    hasGarden: input.hasGarden,
  });
  if (modelled !== null) return modelled;
  const mean = meanPpsqmFor(db, normalisePostcode(input.postcode));
  return mean ? estimateFromPpsqm(mean, input.sizeSqm) : null;
}

/**
 * Manually/assisted-import one listing: classify its area, value it against the
 * LPS fair-value baseline, score the deal, and track it over time. Idempotent
 * per property (stable id); each price/status change appends a snapshot — that
 * accumulating history is the longitudinal record.
 */
export function importListing(
  db: DB,
  input: ListingInput,
  opts: { now?: () => string } = {},
): Listing {
  const now = opts.now ?? (() => new Date().toISOString());
  const at = now();
  const postcode = normalisePostcode(input.postcode);
  const status = input.status ?? "active";
  const fairValue = fairValueFor(db, { ...input, postcode });
  const { dealPct, dealScore } = fairValue
    ? dealMetrics(input.askingPrice, fairValue)
    : { dealPct: 0, dealScore: 0 };

  const id = input.id ?? deriveId(input);
  const existing = db.select().from(listings).where(eq(listings.id, id)).get();

  const row = {
    id,
    source: input.source ?? "propertypal",
    area: classifyArea(postcode),
    address: input.address,
    street: input.street ?? "",
    postcode,
    propertyType: input.propertyType ?? "",
    beds: input.beds ?? null,
    sizeSqm: input.sizeSqm ?? null,
    askingPrice: input.askingPrice,
    url: input.url ?? "",
    status,
    fairValue,
    dealPct,
    dealScore,
    firstSeen: existing?.firstSeen ?? at,
    lastSeen: at,
  };

  db.insert(listings)
    .values(row)
    .onConflictDoUpdate({ target: listings.id, set: row })
    .run();

  const changed =
    !existing ||
    existing.askingPrice !== input.askingPrice ||
    existing.status !== status;
  if (changed) {
    db.insert(listingSnapshots)
      .values({
        id: randomUUID(),
        listingId: id,
        askingPrice: input.askingPrice,
        status,
        seenAt: at,
      })
      .run();
  }

  return db.select().from(listings).where(eq(listings.id, id)).get()!;
}

/** Listings ranked best-deal-first (most under fair value), optionally by area. */
export function rankedListings(db: DB, area?: string, limit = 100): Listing[] {
  const base = db.select().from(listings);
  const rows = area
    ? base.where(eq(listings.area, area)).all()
    : base.all();
  return rows.sort((a, b) => b.dealScore - a.dealScore).slice(0, limit);
}

/** Price/status history for one listing, oldest first. */
export function listingHistory(db: DB, listingId: string) {
  return db
    .select()
    .from(listingSnapshots)
    .where(eq(listingSnapshots.listingId, listingId))
    .orderBy(desc(listingSnapshots.seenAt))
    .all()
    .reverse();
}
