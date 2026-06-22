import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { events, jobRuns, listings } from "@/db/schema";
import { importListing } from "./listings";
import { detectChanges, type WatchConfig } from "./changeDetect";

const watch: WatchConfig = { priceDropPct: 3, dealAlertPct: 15, goneAfterMisses: 3 };

const t0 = new Date(0).toISOString();
const t1 = new Date(60_000).toISOString();

describe("detectChanges", () => {
  it("emits listing.price_drop when the asking price falls by at least the threshold", () => {
    const db = createDb(":memory:");
    const input = { address: "1 Test Street", postcode: "BT1 1AA", askingPrice: 200_000 };
    const listing = importListing(db, input, { now: () => t0 });
    importListing(db, { ...input, id: listing.id, askingPrice: 190_000 }, { now: () => t1 });

    const summary = detectChanges(db, [listing.id], { watch, now: () => t1 });

    expect(summary.priceDrops).toBe(1);
    const ev = db.select().from(events).where(eq(events.type, "listing.price_drop")).get();
    expect(ev?.payload).toEqual({ listingId: listing.id, from: 200_000, to: 190_000, pct: 5 });
  });

  it("does not emit listing.price_drop when the drop is below the threshold", () => {
    const db = createDb(":memory:");
    const input = { address: "1 Test Street", postcode: "BT1 1AA", askingPrice: 200_000 };
    const listing = importListing(db, input, { now: () => t0 });
    // 1% drop, below the 3% threshold
    importListing(db, { ...input, id: listing.id, askingPrice: 198_000 }, { now: () => t1 });

    const summary = detectChanges(db, [listing.id], { watch, now: () => t1 });

    expect(summary.priceDrops).toBe(0);
    expect(db.select().from(events).where(eq(events.type, "listing.price_drop")).all()).toEqual([]);
  });

  it("emits listing.status_change when a listing's status changes between scrapes", () => {
    const db = createDb(":memory:");
    const input = { address: "1 Test Street", postcode: "BT1 1AA", askingPrice: 200_000 };
    const listing = importListing(db, input, { now: () => t0 });
    importListing(db, { ...input, id: listing.id, status: "sstc" as const }, { now: () => t1 });

    const summary = detectChanges(db, [listing.id], { watch, now: () => t1 });

    expect(summary.statusChanges).toBe(1);
    const ev = db.select().from(events).where(eq(events.type, "listing.status_change")).get();
    expect(ev?.payload).toEqual({ listingId: listing.id, from: "active", to: "sstc" });
  });

  it("emits listing.deal for a brand-new listing priced well under fair value", () => {
    const db = createDb(":memory:");
    db.insert(listings)
      .values({
        id: "listing:deal",
        address: "2 Bargain Ave",
        askingPrice: 200_000,
        fairValue: 250_000,
        dealPct: 20,
        firstSeen: t0,
        lastSeen: t0,
      })
      .run();

    const summary = detectChanges(db, ["listing:deal"], { watch, now: () => t0 });

    expect(summary.deals).toBe(1);
    const ev = db.select().from(events).where(eq(events.type, "listing.deal")).get();
    expect(ev?.payload).toEqual({
      listingId: "listing:deal",
      dealPct: 20,
      fairValue: 250_000,
      askingPrice: 200_000,
    });
  });

  it("marks a listing gone and emits status_change after goneAfterMisses completed scrape runs", () => {
    const db = createDb(":memory:");
    db.insert(listings)
      .values({
        id: "listing:stale",
        address: "3 Empty Rd",
        askingPrice: 100_000,
        firstSeen: t0,
        lastSeen: t0,
      })
      .run();

    for (let i = 1; i <= 3; i++) {
      db.insert(jobRuns)
        .values({
          id: `run-${i}`,
          jobId: "job-1",
          kind: "property-scrape",
          status: "ok",
          startedAt: new Date(i * 60_000).toISOString(),
          finishedAt: new Date(i * 60_000).toISOString(),
        })
        .run();
    }

    const summary = detectChanges(db, [], { watch, now: () => new Date(4 * 60_000).toISOString() });

    expect(summary.gone).toBe(1);
    const row = db.select().from(listings).where(eq(listings.id, "listing:stale")).get();
    expect(row?.status).toBe("gone");
    const ev = db.select().from(events).where(eq(events.type, "listing.status_change")).get();
    expect(ev?.payload).toEqual({ listingId: "listing:stale", from: "active", to: "gone" });
  });

  it("does not mark a listing gone before goneAfterMisses scrape runs have completed", () => {
    const db = createDb(":memory:");
    db.insert(listings)
      .values({
        id: "listing:fresh",
        address: "4 Quiet Cl",
        askingPrice: 100_000,
        firstSeen: t0,
        lastSeen: t0,
      })
      .run();

    for (let i = 1; i <= 2; i++) {
      db.insert(jobRuns)
        .values({
          id: `run-${i}`,
          jobId: "job-1",
          kind: "property-scrape",
          status: "ok",
          startedAt: new Date(i * 60_000).toISOString(),
          finishedAt: new Date(i * 60_000).toISOString(),
        })
        .run();
    }

    const summary = detectChanges(db, [], { watch, now: () => new Date(3 * 60_000).toISOString() });

    expect(summary.gone).toBe(0);
    const row = db.select().from(listings).where(eq(listings.id, "listing:fresh")).get();
    expect(row?.status).toBe("active");
  });
});
