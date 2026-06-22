import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { jobRuns, listings, listingSnapshots } from "@/db/schema";
import { emit } from "@/events/bus";

export type WatchConfig = {
  /** emit listing.price_drop once the asking price falls by at least this many percent */
  priceDropPct: number;
  /** emit listing.deal for a brand-new listing priced at least this many percent under fair value */
  dealAlertPct: number;
  /** mark a listing "gone" after this many completed property-scrape runs without seeing it */
  goneAfterMisses: number;
};

export type ChangeSummary = {
  priceDrops: number;
  statusChanges: number;
  deals: number;
  gone: number;
};

function emitEvent(db: DB, type: string, payload: unknown, createdAt: string): void {
  emit(db, type, payload, { now: () => createdAt });
}

/**
 * Diff the listings touched by a scrape (`seenListingIds`) against their
 * snapshot history and emit `events` for price drops, status changes, and
 * new under-value deals. Listings not seen this cycle are checked against
 * completed property-scrape job runs since they were last seen; once that
 * streak reaches `watch.goneAfterMisses`, the listing is marked "gone".
 */
export function detectChanges(
  db: DB,
  seenListingIds: string[],
  opts: { watch: WatchConfig; now?: () => string },
): ChangeSummary {
  const now = opts.now ?? (() => new Date().toISOString());
  const at = now();
  const { priceDropPct, dealAlertPct, goneAfterMisses } = opts.watch;
  const summary: ChangeSummary = { priceDrops: 0, statusChanges: 0, deals: 0, gone: 0 };

  for (const listingId of seenListingIds) {
    const listing = db.select().from(listings).where(eq(listings.id, listingId)).get();
    if (!listing) continue;

    const recent = db
      .select()
      .from(listingSnapshots)
      .where(eq(listingSnapshots.listingId, listingId))
      .orderBy(desc(listingSnapshots.seenAt))
      .limit(2)
      .all();

    if (recent.length === 2 && recent[0]!.seenAt === at) {
      const latest = recent[0]!;
      const previous = recent[1]!;

      if (previous.askingPrice > 0 && latest.askingPrice < previous.askingPrice) {
        const pct = ((previous.askingPrice - latest.askingPrice) / previous.askingPrice) * 100;
        if (pct >= priceDropPct) {
          emitEvent(
            db,
            "listing.price_drop",
            {
              listingId,
              from: previous.askingPrice,
              to: latest.askingPrice,
              pct: Math.round(pct * 10) / 10,
            },
            at,
          );
          summary.priceDrops++;
        }
      }

      if (previous.status !== latest.status) {
        emitEvent(
          db,
          "listing.status_change",
          { listingId, from: previous.status, to: latest.status },
          at,
        );
        summary.statusChanges++;
      }
    }

    if (listing.firstSeen === at && listing.dealPct !== null && listing.dealPct >= dealAlertPct) {
      emitEvent(
        db,
        "listing.deal",
        {
          listingId,
          dealPct: listing.dealPct,
          fairValue: listing.fairValue,
          askingPrice: listing.askingPrice,
        },
        at,
      );
      summary.deals++;
    }
  }

  const seen = new Set(seenListingIds);
  const candidates = db
    .select()
    .from(listings)
    .where(inArray(listings.status, ["active", "sstc"]))
    .all()
    .filter((l) => !seen.has(l.id));

  for (const listing of candidates) {
    const misses = db
      .select()
      .from(jobRuns)
      .where(
        and(
          eq(jobRuns.kind, "property-scrape"),
          eq(jobRuns.status, "ok"),
          gt(jobRuns.startedAt, listing.lastSeen),
        ),
      )
      .all().length;

    if (misses >= goneAfterMisses) {
      db.update(listings).set({ status: "gone" }).where(eq(listings.id, listing.id)).run();
      db.insert(listingSnapshots)
        .values({
          id: randomUUID(),
          listingId: listing.id,
          askingPrice: listing.askingPrice,
          status: "gone",
          seenAt: at,
        })
        .run();
      emitEvent(
        db,
        "listing.status_change",
        { listingId: listing.id, from: listing.status, to: "gone" },
        at,
      );
      summary.gone++;
      summary.statusChanges++;
    }
  }

  return summary;
}
