import { describe, it, expect, vi } from "vitest";
import { createDb } from "@/db/client";
import { geocodeCache } from "@/db/schema";
import { geocodeAddress, geocodeWithCache } from "./geocode";

const NOMINATIM = [
  {
    lat: "54.5831",
    lon: "-5.9095",
    address: { postcode: "BT6 0AA", city: "Belfast" },
  },
];

function fakeFetch(body: unknown) {
  return vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
  );
}

describe("geocodeAddress", () => {
  it("returns postcode and coords from a Nominatim hit", async () => {
    const r = await geocodeAddress("10 Cabin Hill Mews, Belfast", {
      fetchImpl: fakeFetch(NOMINATIM) as unknown as typeof fetch,
    });
    expect(r).toEqual({ postcode: "BT6 0AA", lat: 54.5831, lng: -5.9095 });
  });

  it("returns null when nothing matches", async () => {
    const r = await geocodeAddress("nowhere", {
      fetchImpl: fakeFetch([]) as unknown as typeof fetch,
    });
    expect(r).toBeNull();
  });
});

describe("geocodeWithCache", () => {
  it("queries once then serves from cache", async () => {
    const db = createDb(":memory:");
    const fetchImpl = fakeFetch(NOMINATIM) as unknown as typeof fetch;
    const a = await geocodeWithCache(db, "10 Cabin Hill Mews, Belfast", { fetchImpl });
    const b = await geocodeWithCache(db, "10 Cabin Hill Mews, Belfast", { fetchImpl });
    expect(a?.postcode).toBe("BT6 0AA");
    expect(b?.postcode).toBe("BT6 0AA");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // second call cached
    expect(db.select().from(geocodeCache).all()).toHaveLength(1);
  });

  it("caches misses so they don't retry", async () => {
    const db = createDb(":memory:");
    const fetchImpl = fakeFetch([]) as unknown as typeof fetch;
    expect(await geocodeWithCache(db, "nowhere", { fetchImpl })).toBeNull();
    expect(await geocodeWithCache(db, "nowhere", { fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
