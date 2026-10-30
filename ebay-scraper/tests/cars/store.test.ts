import { expect, it } from "vitest";
import type { Car } from "../../src/cars/listing.js";
import { CarStore } from "../../src/cars/store.js";

const car = (overrides: Partial<Car>): Car => ({
  source: "Used Cars NI",
  id: "1",
  title: "Toyota RAV4",
  price: 20000,
  mileage: 40000,
  registered: "2020-03",
  location: "Belfast",
  distanceMiles: null,
  url: "https://www.usedcarsni.com/x-1",
  images: [],
  listedOn: null,
  fuel: null,
  ...overrides,
});

it("knows when each car was listed, except cars already for sale when tracking began", () => {
  const store = new CarStore(":memory:");
  try {
    const already = car({ id: "1" });
    const autoTrader = car({
      source: "AutoTrader",
      id: "202609010000001",
      listedOn: "2026-09-01",
    });
    const fresh = car({ id: "2" });
    store.record([already, autoTrader], 1000);
    store.record([fresh], 5000);
    for (const c of [already, fresh]) store.checked(c, false);
    const listed = Object.fromEntries(
      store.observations(undefined, 9000).map((o) => [o.car.id, o.listed]),
    );
    expect(listed).toEqual({
      "1": null,
      "202609010000001": Date.parse("2026-09-01"),
      "2": 5000,
    });
  } finally {
    store.close();
  }
});
