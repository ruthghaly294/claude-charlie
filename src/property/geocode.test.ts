import { describe, it, expect, vi } from "vitest";
import { createDb } from "@/db/client";
import { geocodeCache, postcodeValues } from "@/db/schema";
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

  it("returns null instead of throwing when Nominatim errors", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response("oops", { status: 500 })),
    );
    const r = await geocodeAddress("10 Cabin Hill Mews, Belfast", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
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

  it("falls back to the postcode_values centroid when Nominatim errors", async () => {
    const db = createDb(":memory:");
    db.insert(postcodeValues)
      .values({
        postcode: "BT9 5FN",
        latitude: 54.58,
        longitude: -5.94,
        updatedAt: "2026-01-01T00:00:00.000Z",
      })
      .run();

    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response("oops", { status: 500 })),
    );
    const result = await geocodeWithCache(
      db,
      "11 Fairway Gardens, Belfast, BT9 5FN",
      { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: () => Promise.resolve() },
    );
    expect(result).toEqual({ postcode: "BT9 5FN", lat: 54.58, lng: -5.94 });
    expect(db.select().from(geocodeCache).all()).toHaveLength(1);
  });

  it("skips Nominatim entirely when providers excludes it", async () => {
    const db = createDb(":memory:");
    db.insert(postcodeValues)
      .values({
        postcode: "BT9 5FN",
        latitude: 54.58,
        longitude: -5.94,
        updatedAt: "2026-01-01T00:00:00.000Z",
      })
      .run();

    const fetchImpl = fakeFetch(NOMINATIM) as unknown as typeof fetch;
    const result = await geocodeWithCache(
      db,
      "11 Fairway Gardens, Belfast, BT9 5FN",
      { fetchImpl, providers: ["postcode-centroid"] },
    );
    expect(result).toEqual({ postcode: "BT9 5FN", lat: 54.58, lng: -5.94 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not fall back to the centroid when providers excludes it", async () => {
    const db = createDb(":memory:");
    db.insert(postcodeValues)
      .values({
        postcode: "BT9 5FN",
        latitude: 54.58,
        longitude: -5.94,
        updatedAt: "2026-01-01T00:00:00.000Z",
      })
      .run();

    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response("oops", { status: 500 })),
    );
    const result = await geocodeWithCache(
      db,
      "11 Fairway Gardens, Belfast, BT9 5FN",
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: () => Promise.resolve(),
        providers: ["nominatim"],
      },
    );
    expect(result).toBeNull();
  });
});
