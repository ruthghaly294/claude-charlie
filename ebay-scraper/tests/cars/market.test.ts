import { expect, it } from "vitest";
import type { Car } from "../../src/cars/listing.js";
import {
  alertText,
  marketReport,
  parseDepreciation,
  resaleScenarios,
  valuation,
} from "../../src/cars/market.js";

const now = new Date("2026-10-28T12:00:00Z");
const car = (overrides: Partial<Car> = {}): Car => ({
  source: "AutoTrader",
  id: crypto.randomUUID(),
  title: "Toyota RAV4 2.5 VVT-h Dynamic",
  price: 20000,
  mileage: 45000,
  registered: "2020-03",
  location: "Belfast (3 miles)",
  distanceMiles: 3,
  url: "https://www.autotrader.co.uk/car-details/202610287408346",
  images: [],
  listedOn: "2026-10-28",
  fuel: "Hybrid",
  ...overrides,
});
const forSale = (c: Car) => ({ car: c, at: now, gone: false });

it("groups prices by year of age and every 10,000 miles, using medians", () => {
  const report = marketReport(
    [
      forSale(car({ price: 20000 })),
      forSale(car({ price: 22000 })),
      forSale(car({ price: 30000 })),
      forSale(car({ price: 33000, registered: "2026-01", mileage: 900 })),
      forSale(car({ price: 5000, registered: "2018-09", mileage: 150000 })),
      { car: car({ price: 19000 }), at: now, gone: true },
    ],
    now,
  ).join("\n");
  expect(report).toContain("4 for sale");
  expect(report).toContain("1 gone");
  expect(report).toMatch(/0–1 years old[\s\S]*0-10k\s+£33,000 ×1/);
  expect(report).toMatch(
    /6–7 years old[\s\S]*40-50k\s+£22,000 ×3\s+£19,000 ×1/,
  );
  expect(report).not.toContain("8–9 years");
  expect(report).not.toContain("£5,000");
});

it("splits a large grid into messages Telegram accepts", () => {
  const cars = Array.from({ length: 8 * 25 }, (_, i) =>
    forSale(
      car({
        registered: `${2019 + (i % 8)}-11`,
        mileage: Math.floor(i / 8) * 10000,
      }),
    ),
  );
  const messages = marketReport(cars, now);
  expect(messages.length).toBeGreaterThan(1);
  expect(messages.every((m) => m.length <= 4000)).toBe(true);
  expect(
    messages.every(
      (m) =>
        (m.match(/<pre>/g) ?? []).length === (m.match(/<\/pre>/g) ?? []).length,
    ),
  ).toBe(true);
});

it("values a car against similar cars for sale, once there are at least 3", () => {
  const listed = car({ price: 18000 });
  const similar = [20000, 21000, 23000].map((price) => forSale(car({ price })));
  expect(valuation(listed, similar.slice(0, 2), now)).toBeUndefined();
  expect(valuation(listed, [...similar, forSale(listed)], now)).toEqual({
    median: 21000,
    count: 3,
    age: 6,
    miles: 4,
  });
});

it("tells the owner when an AutoTrader car was listed and how it compares", () => {
  const text = alertText(car({ price: 18000, title: "RAV4 <Excel>" }), {
    now,
    firstSeen: now.getTime(),
    value: { median: 21000, count: 3, age: 6, miles: 4 },
  });
  expect(text).toContain("RAV4 &lt;Excel&gt;");
  expect(text).toContain("£18,000");
  expect(text).toContain("45,000 miles");
  expect(text).toContain("Registered Mar 2020 (6 years old)");
  expect(text).toContain("Listed 28 Oct 2026");
  expect(text).toContain("£3,000 below the £21,000 median of 3 similar");
  expect(text).toContain(
    '<a href="https://www.autotrader.co.uk/car-details/202610287408346">',
  );
  expect(text.length).toBeLessThanOrEqual(1024);
});

it("gives the first-seen time when the site does not publish a listing date", () => {
  const text = alertText(
    car({ source: "Used Cars NI", listedOn: null, distanceMiles: null }),
    { now, firstSeen: Date.parse("2026-10-28T14:20:00Z") },
  );
  expect(text).toContain("First seen 28 Oct 2026, 14:20");
  expect(text).toContain("Not enough similar cars yet");
});

it("says when a new car has no photos yet", () => {
  expect(alertText(car({ images: [] }), { now, firstSeen: 0 })).toContain(
    "No photos yet",
  );
  expect(
    alertText(
      car({ images: ["https://m.atcdn.co.uk/a/media/w800h600/1.jpg"] }),
      {
        now,
        firstSeen: 0,
      },
    ),
  ).not.toContain("No photos yet");
});

it("reads The Money Calculator's three-year depreciation estimate", () => {
  expect(
    parseDepreciation(
      "We estimated Toyota RAV4 models on average depreciate 36 percent in the first three years when new.",
    ),
  ).toBe(36);
  expect(parseDepreciation("Just a moment...")).toBeUndefined();
});

it("compares real prices by age with The Money Calculator's estimate", () => {
  const cars = [
    ...[40000, 42000].map((price) =>
      forSale(car({ price, registered: "2026-03", mileage: 3000 })),
    ),
    ...[29000, 31000].map((price) =>
      forSale(car({ price, registered: "2023-03", mileage: 30000 })),
    ),
    { car: car({ price: 20000, registered: "2019-03" }), at: now, gone: true },
  ];
  const report = marketReport(cars, now, {
    benchmark: { threeYearLoss: 36 },
  }).join("\n");
  expect(report).toContain("Depreciation");
  expect(report).toMatch(/0–1 years\s+£41,000\s+100%/);
  expect(report).toMatch(/3–4 years\s+£30,000\s+73%/);
  expect(report).toMatch(/7–8 years\s+£20,000\s+49%/);
  expect(report).toContain(
    "The Money Calculator estimates Toyota RAV4s lose 36% in their first 3 years",
  );
  expect(report).toContain(
    "our 3–4 year old cars are 27% below 0–1 year old ones",
  );
  expect(marketReport(cars, now).join("\n")).not.toContain("Money Calculator");
});

it("shows how fast cars sold and how they were priced against similar cars", () => {
  const day = 86400000;
  const sold = (price: number, listedDaysAgo: number, goneDaysAgo: number) => ({
    car: car({ price }),
    at: new Date(now.getTime() - goneDaysAgo * day),
    gone: true,
    listed: now.getTime() - listedDaysAgo * day,
  });
  const report = marketReport(
    [
      ...[20000, 20000, 20000, 20000].map((price) => forSale(car({ price }))),
      sold(18000, 3, 1),
      sold(22000, 45, 5),
      { ...sold(19000, 0, 0), listed: null },
    ],
    now,
  ).join("\n");
  expect(report).toContain("Time to sell");
  expect(report).toMatch(/0–7 days\s+1\s+-10%/);
  expect(report).toMatch(/29–56 days\s+1\s+\+10%/);
  expect(report).toContain("Median time to sell: 21 days (2 cars");
});

it("explains that sale speed needs sold cars before it can be shown", () => {
  expect(marketReport([forSale(car())], now).join("\n")).toContain(
    "no sold cars with a known listing date yet",
  );
});

it("analyses each fuel type separately", () => {
  const hybrid = [20000, 21000, 22000].map((price) => forSale(car({ price })));
  const plugIn = [30000, 31000, 32000].map((price) =>
    forSale(car({ price, fuel: "Plug-in hybrid" })),
  );
  const report = marketReport([...hybrid, ...plugIn], now).join("\n");
  expect(report).toMatch(/Hybrid · 6–7 years old[\s\S]*40-50k\s+£21,000 ×3/);
  expect(report).toMatch(
    /Plug-in hybrid · 6–7 years old[\s\S]*40-50k\s+£31,000 ×3/,
  );
  expect(
    valuation(car({ fuel: "Plug-in hybrid" }), [...hybrid, ...plugIn], now),
  ).toMatchObject({ median: 31000, count: 3 });
  expect(alertText(car(), { now, firstSeen: 0 })).toContain("· Hybrid");
});

it("names the watched car and uses its own age limit", () => {
  const report = marketReport(
    [forSale(car({ registered: "2023-03" })), forSale(car())],
    now,
    { title: "Toyota Yaris", maxAge: 4 },
  ).join("\n");
  expect(report).toContain("Toyota Yaris market, under 4 years old");
  expect(report).toContain("3–4 years old");
  expect(report).not.toContain("6–7 years old");
});

const modelled = () =>
  Array.from({ length: 7 * 10 }, (_, i) => {
    const age = 1 + (i % 7);
    const miles = 1 + Math.floor(i / 7);
    return forSale(
      car({
        registered: `${2026 - age}-10`,
        mileage: miles * 10000,
        price: Math.round(40000 * Math.exp(-0.08 * age - 0.03 * miles)),
      }),
    );
  });

it("estimates what buying at one age and mileage and selling at 100k miles would cost", () => {
  const scenario = resaleScenarios(modelled()).find(
    (s) => s.fuel === "Hybrid" && s.buyAge === 5 && s.buyMiles === 60000,
  );
  const pay = 40000 * Math.exp(-0.4 - 0.18);
  const get = 40000 * Math.exp(-0.72 - 0.3);
  expect(scenario?.sellAge).toBe(9);
  expect(scenario?.sellMiles).toBe(100000);
  expect(scenario?.years).toBe(4);
  expect(scenario?.pay).toBeCloseTo(pay, -1);
  expect(scenario?.get).toBeCloseTo(get, -1);
  expect(scenario?.perYear).toBeCloseTo((pay - get) / 4, -1);
  expect(scenario?.perMile).toBeCloseTo((pay - get) / 40000, 2);
  expect(scenario?.beyondData).toBe(true);
});

it("adds the resale strategy to the market report", () => {
  const report = marketReport(modelled(), now).join("\n");
  expect(report).toContain("Resale strategy, Hybrid");
  expect(report).toMatch(
    /Buy at 5 years, 60k → sell at 9 years, 100k\*: pay £22,[0-9]{3}, sell for £14,[0-9]{3}, lose £7,[0-9]{3} \(£1,99[0-9] a year, £1,99[0-9] per 10k miles, 19\.[0-9]p a mile\)/,
  );
  expect(report).toContain("10,000 miles a year");
  expect(report).toContain("* beyond the ages in our data");
});

it("leaves the resale strategy out until there are enough cars to model", () => {
  expect(resaleScenarios(modelled().slice(0, 10))).toEqual([]);
  expect(marketReport(modelled().slice(0, 10), now).join("\n")).not.toContain(
    "Resale strategy",
  );
});
