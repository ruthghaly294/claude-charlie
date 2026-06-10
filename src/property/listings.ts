import { createHash, randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { listings, listingSnapshots, type Listing } from "@/db/schema";
import { classifyArea, normalisePostcode, outwardCode } from "./postcodes";
import {
  estimatePrice,
  estimateFromPpsqm,
  estimateSizeSqm,
  dealMetrics,
} from "./valuation";
import {
  loadCoefMap,
  meanPpsqmFor,
  meanValFor,
  areaMeanVal,
  districtPpsqm,
} from "./referenceIngest";

export type ListingInput = {
  id?: string;
  source?: string;
  address: string;
  street?: string;
  postcode?: string;
  /** explicit area when there's no postcode (e.g. from an agent URL slug) */
  area?: string;
  propertyType?: string;
  beds?: number;
  sizeSqm?: number;
  askingPrice: number;
  url?: string;
  lat?: number;
  lng?: number;
  hasGarage?: boolean;
  hasGarden?: boolean;
  status?: "active" | "sstc" | "sold" | "gone";
};

function deriveId(input: ListingInput): string {
  const basis =
    input.url?.trim() ||
    `${input.postcode ? normalisePostcode(input.postcode) : ""}|${input.address}`;
  return `listing:${createHash("sha1").update(basis).digest("hex").slice(0, 16)}`;
}

export type Valuation = { value: number | null; basis: string };

/**
 * Fair value, £/m²-first (the LPS-derived square-metre value is the engine):
 * fair = £/m² × floor area, where £/m² is, in order, the postcode calculator
 * model → postcode mean → postcode-district mean; and floor area is the real
 * size if known, else estimated from beds + type. Only when there's no usable
 * £/m² (no postcode in the LPS set) does it fall back to a mean-value figure.
 * `basis` records exactly which was used (and whether size was estimated).
 */
export function fairValueFor(
  db: DB,
  input: {
    postcode?: string;
    sizeSqm?: number;
    beds?: number;
    propertyType?: string;
    area?: string;
    hasGarage?: boolean;
    hasGarden?: boolean;
  },
): Valuation {
  const pc = input.postcode ? normalisePostcode(input.postcode) : "";
  const realSize = input.sizeSqm && input.sizeSqm > 0 ? input.sizeSqm : null;
  const size = realSize ?? estimateSizeSqm(input.propertyType ?? "", input.beds);
  const note = realSize ? "" : " · est. size";

  if (pc && size) {
    const modelled = estimatePrice(loadCoefMap(db), {
      postcode: pc,
      sizeSqm: size,
      hasGarage: input.hasGarage,
      hasGarden: input.hasGarden,
    });
    if (modelled !== null) return { value: modelled, basis: `postcode model${note}` };

    const mean = meanPpsqmFor(db, pc);
    if (mean) return { value: estimateFromPpsqm(mean, size), basis: `postcode £/m²${note}` };

    const dist = districtPpsqm(db, outwardCode(pc));
    if (dist) return { value: estimateFromPpsqm(dist, size), basis: `district £/m²${note}` };
  }

  if (pc) {
    const mv = meanValFor(db, pc);
    if (mv) return { value: mv, basis: "postcode average" };
  }
  const area = input.area ?? (pc ? classifyArea(pc) : "other");
  if (area === "east-belfast" || area === "south-belfast") {
    const av = areaMeanVal(db, area);
    if (av) return { value: av, basis: "area average" };
  }
  return { value: null, basis: "none" };
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
  const postcode = input.postcode ? normalisePostcode(input.postcode) : "";
  // a real postcode is authoritative for area; else fall back to the slug-derived area
  const area = postcode ? classifyArea(postcode) : (input.area ?? "other");
  const status = input.status ?? "active";
  const val = fairValueFor(db, {
    postcode,
    sizeSqm: input.sizeSqm,
    beds: input.beds,
    propertyType: input.propertyType,
    area,
    hasGarage: input.hasGarage,
    hasGarden: input.hasGarden,
  });
  const { dealPct, dealScore } = val.value
    ? dealMetrics(input.askingPrice, val.value)
    : { dealPct: 0, dealScore: 0 };

  const id = input.id ?? deriveId(input);
  const existing = db.select().from(listings).where(eq(listings.id, id)).get();

  const row = {
    id,
    source: input.source ?? "propertypal",
    area,
    address: input.address,
    street: input.street ?? "",
    postcode,
    propertyType: input.propertyType ?? "",
    beds: input.beds ?? null,
    sizeSqm: input.sizeSqm ?? null,
    askingPrice: input.askingPrice,
    url: input.url ?? "",
    status,
    fairValue: val.value,
    dealPct,
    dealScore,
    valuationBasis: val.basis,
    latitude: input.lat ?? existing?.latitude ?? null,
    longitude: input.lng ?? existing?.longitude ?? null,
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
