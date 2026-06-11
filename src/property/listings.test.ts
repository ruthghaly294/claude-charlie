import { describe, it, expect, vi } from "vitest";
import { createDb, type DB } from "@/db/client";
import { listings, listingSnapshots, valuationCoefs, postcodeValues } from "@/db/schema";
import {
  importListing,
  importListingEnriched,
  rankedListings,
  listingHistory,
} from "./listings";

function seedReference(db: DB) {
  const now = new Date().toISOString();
  db.insert(valuationCoefs)
    .values([
      { coef: "area_m2", valueMean: -4.10325, updatedAt: now },
      { coef: "area_squared", valueMean: 0.00429, updatedAt: now },
      { coef: "has_garden_01", valueMean: 219.5, updatedAt: now },
      { coef: "BT5 6AB", valueMean: 2210, updatedAt: now },
    ])
    .run();
  db.insert(postcodeValues)
    .values({
      postcode: "BT9 7AA",
      meanPpsqm: 3000,
      meanVal: 330000,
      meanSize: 110,
      nProperties: 30,
      quarter: "2025_Q3",
      updatedAt: now,
    })
    .run();
}

describe("importListing", () => {
  it("values a listing against the calculator model and scores the deal", () => {
    const db = createDb(":memory:");
    seedReference(db);
    const l = importListing(db, {
      address: "1 Test St",
      postcode: "BT5 6AB",
      sizeSqm: 100,
      hasGarden: true,
      askingPrice: 180000,
      url: "https://www.propertypal.com/x/1",
    });
    expect(l.area).toBe("east-belfast");
    expect(l.fairValue).toBe(206207);
    expect(l.dealScore).toBeGreaterThan(0); // asking below fair value
    expect(db.select().from(listingSnapshots).all()).toHaveLength(1);
  });

  it("falls back to postcode mean £/m² when no calculator coef exists", () => {
    const db = createDb(":memory:");
    seedReference(db);
    const l = importListing(db, {
      address: "2 South Rd",
      postcode: "BT9 7AA",
      sizeSqm: 100,
      askingPrice: 250000,
    });
    expect(l.fairValue).toBe(300000); // 3000 £/m² × 100
    expect(l.area).toBe("south-belfast");
  });

  it("tracks price changes as new snapshots, idempotent per property", () => {
    const db = createDb(":memory:");
    seedReference(db);
    const input = {
      address: "1 Test St",
      postcode: "BT5 6AB",
      sizeSqm: 100,
      askingPrice: 200000,
      url: "https://www.propertypal.com/x/1",
    };
    importListing(db, input);
    importListing(db, input); // unchanged → no new snapshot
    importListing(db, { ...input, askingPrice: 185000 }); // price drop → snapshot
    expect(db.select().from(listings).all()).toHaveLength(1);
    const hist = listingHistory(db, db.select().from(listings).get()!.id);
    expect(hist.map((h) => h.askingPrice)).toEqual([200000, 185000]);
  });

  it("values on real LPS floor area and records the size source", async () => {
    const db = createDb(":memory:");
    seedReference(db);
    const search = JSON.stringify([
      {
        propertyId: "9",
        fullAddress: "3 Test St, Belfast BT5 6AB",
        capitalValue: "£150,000",
      },
    ]);
    const detail = `<th>Description</th><td>house garden</td>
      <th>Capital Value (non‑exempt)</th><td>&#xA3;150,000.00</td>
      <th>Property size</th><td>100m&#xB2;</td>
      <th>Garage</th><td>No</td>`;
    const fetchImpl = vi.fn((url: unknown) =>
      Promise.resolve(
        new Response(String(url).includes("Details") ? detail : search),
      ),
    ) as unknown as typeof fetch;

    const l = await importListingEnriched(
      db,
      { address: "3 Test St", postcode: "BT5 6AB", askingPrice: 180000 },
      { fetchImpl },
    );
    expect(l.sizeSqm).toBe(100); // real LPS size, not a beds estimate
    expect(l.sizeSource).toBe("lps");
    expect(l.lpsCapitalValue).toBe(150000);
    expect(l.fairValue).toBe(206207); // garden picked up from LPS description
    expect(l.valuationBasis).toBe("postcode model · LPS size");
  });

  it("ranks best deals first", () => {
    const db = createDb(":memory:");
    seedReference(db);
    importListing(db, { address: "cheap", postcode: "BT5 6AB", sizeSqm: 100, askingPrice: 150000, url: "a" });
    importListing(db, { address: "dear", postcode: "BT5 6AB", sizeSqm: 100, askingPrice: 260000, url: "b" });
    const ranked = rankedListings(db, "east-belfast");
    expect(ranked[0]?.address).toBe("cheap");
    expect(ranked[0]!.dealScore).toBeGreaterThan(ranked[1]!.dealScore);
  });
});
