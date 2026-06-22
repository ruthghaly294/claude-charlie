import { describe, it, expect } from "vitest";
import { createDb } from "@/db/client";
import { listings } from "@/db/schema";
import { emit } from "../bus";
import { createDealAlertHandlers } from "./dealAlert";
import { DEFAULT_NOTIFY_CONFIG } from "@/discovery/config";

function seedListing(db: ReturnType<typeof createDb>, over: Partial<typeof listings.$inferInsert> = {}) {
  db.insert(listings)
    .values({
      id: "l1",
      address: "12 Acacia Ave, BT9",
      url: "https://example.com/listing/l1",
      askingPrice: 210_000,
      fairValue: 253_000,
      dealPct: 17,
      firstSeen: "2026-01-01T00:00:00.000Z",
      lastSeen: "2026-01-01T00:00:00.000Z",
      ...over,
    })
    .run();
}

describe("createDealAlertHandlers", () => {
  it("formats a listing.deal event with address, price, fair value, and url", async () => {
    const db = createDb(":memory:");
    seedListing(db);
    const handlers = createDealAlertHandlers(db, DEFAULT_NOTIFY_CONFIG);

    const event = emit(db, "listing.deal", {
      listingId: "l1",
      dealPct: 17,
      fairValue: 253_000,
      askingPrice: 210_000,
    });

    const message = await handlers["listing.deal"]!(event);

    expect(message).toEqual({
      title: "Deal alert",
      body: "12 Acacia Ave, BT9 — £210,000, 17% under fair value £253,000",
      url: "https://example.com/listing/l1",
      priority: "high", // listing.deal severity defaults to "high"
    });
  });

  it("formats a listing.price_drop event with from/to prices and percent", async () => {
    const db = createDb(":memory:");
    seedListing(db);
    const handlers = createDealAlertHandlers(db, DEFAULT_NOTIFY_CONFIG);

    const event = emit(db, "listing.price_drop", { listingId: "l1", from: 230_000, to: 210_000, pct: 8.7 });

    const message = await handlers["listing.price_drop"]!(event);

    expect(message).toEqual({
      title: "Price drop",
      body: "12 Acacia Ave, BT9 dropped from £230,000 to £210,000 (-8.7%)",
      url: "https://example.com/listing/l1",
      priority: "default", // listing.price_drop severity defaults to "medium"
    });
  });

  it("formats a listing.status_change event with from/to status", async () => {
    const db = createDb(":memory:");
    seedListing(db);
    const handlers = createDealAlertHandlers(db, DEFAULT_NOTIFY_CONFIG);

    const event = emit(db, "listing.status_change", { listingId: "l1", from: "active", to: "sstc" });

    const message = await handlers["listing.status_change"]!(event);

    expect(message).toEqual({
      title: "Listing status changed",
      body: "12 Acacia Ave, BT9: active → sstc",
      url: "https://example.com/listing/l1",
      priority: "low", // listing.status_change severity defaults to "low"
    });
  });

  it("returns null when the referenced listing no longer exists", async () => {
    const db = createDb(":memory:");
    const handlers = createDealAlertHandlers(db, DEFAULT_NOTIFY_CONFIG);

    const event = emit(db, "listing.deal", {
      listingId: "missing",
      dealPct: 17,
      fairValue: 253_000,
      askingPrice: 210_000,
    });

    expect(await handlers["listing.deal"]!(event)).toBeNull();
  });
});
