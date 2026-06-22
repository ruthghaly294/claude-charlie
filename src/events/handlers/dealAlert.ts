import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { listings } from "@/db/schema";
import type { NotifyConfig } from "@/discovery/config";
import type { EventHandlers } from "../bus";
import { priorityFor } from "./severity";

function formatGbp(amount: number): string {
  return `£${Math.round(amount).toLocaleString("en-GB")}`;
}

function label(listing: typeof listings.$inferSelect): string {
  return listing.address || listing.street || listing.id;
}

/**
 * listing.deal / listing.price_drop / listing.status_change → a one-line
 * alert naming the listing, with its URL and a priority derived from
 * notify.events severity.
 */
export function createDealAlertHandlers(db: DB, notify: NotifyConfig): EventHandlers {
  const findListing = (listingId: string) =>
    db.select().from(listings).where(eq(listings.id, listingId)).get();

  return {
    "listing.deal": (event) => {
      const payload = event.payload as {
        listingId: string;
        dealPct: number;
        fairValue: number;
        askingPrice: number;
      };
      const listing = findListing(payload.listingId);
      if (!listing) return null;
      return {
        title: "Deal alert",
        body: `${label(listing)} — ${formatGbp(payload.askingPrice)}, ${Math.round(payload.dealPct)}% under fair value ${formatGbp(payload.fairValue)}`,
        url: listing.url || undefined,
        priority: priorityFor(notify, event.type),
      };
    },

    "listing.price_drop": (event) => {
      const payload = event.payload as { listingId: string; from: number; to: number; pct: number };
      const listing = findListing(payload.listingId);
      if (!listing) return null;
      return {
        title: "Price drop",
        body: `${label(listing)} dropped from ${formatGbp(payload.from)} to ${formatGbp(payload.to)} (-${payload.pct}%)`,
        url: listing.url || undefined,
        priority: priorityFor(notify, event.type),
      };
    },

    "listing.status_change": (event) => {
      const payload = event.payload as { listingId: string; from: string; to: string };
      const listing = findListing(payload.listingId);
      if (!listing) return null;
      return {
        title: "Listing status changed",
        body: `${label(listing)}: ${payload.from} → ${payload.to}`,
        url: listing.url || undefined,
        priority: priorityFor(notify, event.type),
      };
    },
  };
}
