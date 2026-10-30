import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  parseAutoTrader,
  parseCatalogue,
  parseUsedCarsNi,
  writtenOff,
} from "../../src/cars/listing.js";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/cars/${name}`, import.meta.url), "utf8");
const at = (body: unknown) =>
  parseAutoTrader(body, { model: "RAV4", fuel: "Hybrid" });

it("reads AutoTrader search results, skipping adverts that are not cars", () => {
  const { cars, pages } = at(JSON.parse(fixture("autotrader.json")));
  expect(pages).toBe(62);
  expect(cars).toHaveLength(6);
  expect(cars[0]).toEqual({
    source: "AutoTrader",
    id: "202608275494300",
    title: "Toyota RAV4 2.5 VVT-h Dynamic CVT 4WD Euro 6 (s/s) 5dr",
    price: 21950,
    mileage: 41963,
    registered: "2019-09",
    location: "Rickmansworth (306 miles)",
    distanceMiles: 306,
    url: "https://www.autotrader.co.uk/car-details/202608275494300",
    images: [
      "https://m.atcdn.co.uk/a/media/w800h600/482cecaa17a54261829e5dae2d51bd43.jpg",
      "https://m.atcdn.co.uk/a/media/w800h600/6aead702d2f74187a3eb293baeebc9fb.jpg",
      "https://m.atcdn.co.uk/a/media/w800h600/75db8d0691264c5084829db47eb635ac.jpg",
      "https://m.atcdn.co.uk/a/media/w800h600/24d7aabcf5954483a4dc1fd1cc3d7dbc.jpg",
    ],
    listedOn: "2026-08-27",
    fuel: "Hybrid",
  });
  expect(cars.map((car) => car.registered)).toEqual([
    "2019-09",
    "2023-09",
    "2023-09",
    "2019-09",
    "2018-09",
    "2019-09",
  ]);
});

it("dates registrations from the plate, or mid-year when there is no plate", () => {
  const body = JSON.parse(fixture("autotrader.json"));
  const listing = body[0].data.searchResults.listings[1];
  const withBadge = (displayText: string) =>
    at([
      {
        data: {
          searchResults: {
            page: { count: 1 },
            listings: [
              {
                ...listing,
                badges: [
                  { type: "MILEAGE", displayText: "1,000 miles" },
                  { type: "REGISTERED_YEAR", displayText },
                ],
              },
            ],
          },
        },
      },
    ]).cars[0]?.registered;
  expect(withBadge("2020 (20 reg)")).toBe("2020-03");
  expect(withBadge("2023")).toBe("2023-07");
});

it("rejects a page that is not an AutoTrader search response", () => {
  expect(() => at({ error: "challenge" })).toThrow();
});

it("reads Used Cars NI result cards and whether more pages follow", () => {
  const { cars, more } = parseUsedCarsNi(fixture("usedcarsni.html"));
  expect(more).toBe(true);
  expect(cars).toHaveLength(3);
  expect(cars[0]).toEqual({
    source: "Used Cars NI",
    id: "413818101",
    title: "Toyota RAV4 2.0 D-4D Icon TSS 5dr [Nav] 2WD",
    price: 10850,
    mileage: 91000,
    registered: "2018-01",
    location: "Omagh",
    distanceMiles: null,
    url: "https://www.usedcarsni.com/2018-Toyota-RAV4-2-0-D-4D-Icon-TSS-5dr-Nav-2WD-413818101",
    images: [
      "https://image.usedcarsni.com/photos/000/413/818/101/414880832.600.jpg",
    ],
    listedOn: null,
    fuel: "Diesel",
  });
  expect(cars.map((car) => car.fuel)).toEqual(["Diesel", "Hybrid", "Hybrid"]);
  expect(cars.map((car) => car.registered).sort()).toEqual([
    "2018-01",
    "2018-06",
    "2018-07",
  ]);
  expect(parseUsedCarsNi("<html><body></body></html>")).toEqual({
    cars: [],
    more: false,
  });
});

it("finds the listings among the other results AutoTrader batches with them", () => {
  const [listings] = JSON.parse(fixture("autotrader.json"));
  const facets = { data: { searchResults: { facets: [] } } };
  expect(at([facets, listings]).cars).toHaveLength(6);
});

it("drops write-offs, damaged cars and non-runners from both sites", () => {
  const body = JSON.parse(fixture("autotrader.json"));
  const listings = body[0].data.searchResults.listings;
  listings[1].attentionGrabber = "CAT N | LOW MILES";
  listings[2].subTitle = "2.5 VVT-h Dynamic (Category S) 5dr";
  listings[3].attentionGrabber = "Spares or repair";
  expect(at(body).cars.map((car) => car.id)).not.toEqual(
    expect.arrayContaining(["202608275494300"]),
  );
  expect(at(body).cars).toHaveLength(3);
  const html = fixture("usedcarsni.html")
    .replace(/Icon  TSS  5dr  \[Nav\]  2WD/g, "Icon CAT S 5dr")
    .replace(/Hybrid  Excel/g, "Hybrid Excel Non Runner");
  expect(parseUsedCarsNi(html).cars.map((car) => car.id)).toEqual([
    "410208768",
  ]);
});

it("keeps ordinary adverts that only mention a catalytic converter or category", () => {
  const body = JSON.parse(fixture("autotrader.json"));
  body[0].data.searchResults.listings[1].attentionGrabber =
    "NEW CATALYTIC CONVERTER | CATEGORY LEADER";
  expect(at(body).cars).toHaveLength(6);
});

it("keeps dealer cars only, never private sellers", () => {
  const body = JSON.parse(fixture("autotrader.json"));
  body[0].data.searchResults.listings[1].sellerType = "PRIVATE";
  expect(at(body).cars.map((car) => car.id)).not.toContain("202608275494300");
  expect(at(body).cars).toHaveLength(5);
  const html = fixture("usedcarsni.html").replace(
    /showHeart\(413818101, false, false,\{[^)]*\}\)/g,
    "showHeart(413818101, false, false,null)",
  );
  expect(parseUsedCarsNi(html).cars.map((car) => car.id)).not.toContain(
    "413818101",
  );
  expect(parseUsedCarsNi(html).cars).toHaveLength(2);
});

it("includes brand-new stock whose photos are still coming soon", () => {
  const body = JSON.parse(fixture("autotrader.json"));
  body[0].data.searchResults.listings[1].images = [];
  expect(at(body).cars[0]?.images).toEqual([]);
  const html = fixture("usedcarsni.html").replace(
    /<picture>[\s\S]*?<\/picture>/,
    '<img src="/responsive/images/coming-soon.png" />',
  );
  const cars = parseUsedCarsNi(html).cars;
  expect(cars).toHaveLength(3);
  expect(cars[0]?.images).toEqual([]);
});

it("ignores reassurances that a car has never been a write-off", () => {
  expect(
    writtenOff(
      "History check includes verification that it has never been written-off or stolen",
    ),
  ).toBe(false);
  expect(writtenOff("HPI clear, not a Cat S or Cat N")).toBe(false);
  expect(writtenOff("No accident damage. Free from engine faults.")).toBe(
    false,
  );
  expect(writtenOff("Cat N in 2023, professionally repaired")).toBe(true);
  expect(writtenOff("Never smoked in. Category S, repaired")).toBe(true);
});

it("only keeps AutoTrader cars of the watched model", () => {
  const body = JSON.parse(fixture("autotrader.json"));
  expect(parseAutoTrader(body, { model: "Yaris", fuel: null }).cars).toEqual(
    [],
  );
  expect(
    parseAutoTrader(body, { model: "rav-4", fuel: null }).cars,
  ).toHaveLength(6);
});

it("lists a make's models with their Used Cars NI ids", () => {
  const models = parseCatalogue(fixture("usedcarsni-toyota.html"), "model");
  expect(models).toContainEqual({ id: "1262", name: "Yaris" });
  expect(models).toContainEqual({ id: "299179359", name: "Yaris Cross" });
  expect(models).toContainEqual({ id: "7822", name: "RAV4" });
  expect(models.some((m) => m.id === "0")).toBe(false);
  expect(
    parseCatalogue(fixture("usedcarsni-toyota.html"), "make"),
  ).toContainEqual({ id: "30", name: "Toyota" });
});

it("maps every site's fuel wording onto five fuel types", async () => {
  const { fuelType } = await import("../../src/cars/listing.js");
  expect(
    [
      "DIESEL",
      "Petrol Hybrid",
      "Petrol/Electric Hybrid",
      "Hybrid Electric",
      "Petrol Plug-in Hybrid",
      "Electric",
      "Petrol",
      "LPG",
    ].map(fuelType),
  ).toEqual([
    "Diesel",
    "Hybrid",
    "Hybrid",
    "Hybrid",
    "Plug-in hybrid",
    "Electric",
    "Petrol",
    null,
  ]);
});
