import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseAsda,
  parseLidl,
  parseSainsburys,
  parseDeals,
  parseTesco,
  pencePer100ml,
  priceReport,
} from "../../src/food/prices.js";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/food/${name}`, import.meta.url), "utf8");
const json = (name: string): unknown => JSON.parse(fixture(name));

describe("reading Pepsi Max prices from each shop", () => {
  it("reads Tesco's standard and Clubcard prices, ignoring flavours and premixes", () => {
    const offers = parseTesco(fixture("tesco.html"));
    expect(offers.map((o) => `${o.count}x${o.ml}`)).toEqual([
      "24x330",
      "8x330",
    ]);
    expect(offers[0]).toMatchObject({
      shop: "Tesco",
      title: "Pepsi Max No Sugar Cola Cans 24x330ml",
      url: "https://www.tesco.com/shop/en-GB/products/282774907",
      format: "can",
      standard: 11.75,
      member: { price: 8, label: "Clubcard Price", until: "03/11/2026" },
    });
    expect(offers[1]).toMatchObject({ standard: 4.19, member: null });
  });

  it("reads Sainsbury's prices and Nectar multibuys", () => {
    const offers = parseSainsburys(json("sainsburys.json"));
    expect(
      offers.map((o) => [o.title, o.standard, o.member?.label ?? null]),
    ).toEqual(
      expect.arrayContaining([
        ["Pepsi Max No Sugar Cola Cans 24x330ml", 8.5, null],
        ["Pepsi Max 15 x 330ml No Sugar Cans", 8.25, null],
        [
          "Pepsi Max No Sugar Cola Bottle 2L",
          2.45,
          "Any 2 for £3.50 with Nectar",
        ],
      ]),
    );
    expect(
      offers.some((o) => /cherry|lime|caffeine|captain/i.test(o.title)),
    ).toBe(false);
    expect(
      offers.find((o) => o.title === "Pepsi Max No Sugar Cola Bottle 2L")
        ?.member,
    ).toMatchObject({ price: 1.75, buy: 2 });
  });

  it("reads Asda Pepsi Max packs from brand and pack-size fields", () => {
    const offers = parseAsda(json("asda.json"));
    expect(offers.map((o) => [o.count, o.ml, o.format, o.standard])).toEqual(
      expect.arrayContaining([
        [24, 330, "can", 12.5],
        [1, 2000, "bottle", 2],
      ]),
    );
    expect(offers.every((o) => o.shop === "Asda")).toBe(true);
    expect(offers.some((o) => /coca|cherry/i.test(o.title))).toBe(false);
  });

  it("reads Lidl Plus multibuys as a per-pack price", () => {
    expect(parseLidl(json("lidl.json"))).toEqual([
      expect.objectContaining({
        shop: "Lidl",
        count: 8,
        ml: 330,
        standard: 4.15,
        member: expect.objectContaining({
          price: 3.5,
          buy: 2,
          label: "2 for £7.00 with Lidl Plus",
        }),
        url: "https://www.lidl-ni.co.uk/p/pepsi-max/p10056228",
      }),
    ]);
  });

  it("turns a Spar deal without a printed price into an honest upper limit", () => {
    expect(parseDeals(fixture("spar.html"), "Spar")).toEqual([
      expect.objectContaining({
        shop: "Spar",
        count: 1,
        ml: 1250,
        format: "bottle",
        standard: 1.225,
        upTo: true,
        note: "Less Than 1/2 Price, was £2.45",
      }),
    ]);
  });

  it("reads Eurospar's Super Deals the same way, including multibuys", () => {
    const page = fixture("eurospar.html");
    expect(parseDeals(page, "Eurospar")).toEqual([]);
    const withPepsi = page.replace(
      /SPAR Dinner Sausages[^<"]*<\/h3> <div> <p>[^<]*/,
      "Pepsi Max Cans</h3> <div> <p>8 x 330ml. Any 2 For &#163;7. &#163;4.15 each.",
    );
    expect(parseDeals(withPepsi, "Eurospar")).toEqual([
      expect.objectContaining({
        shop: "Eurospar",
        count: 8,
        ml: 330,
        standard: 3.5,
        note: "Any 2 For £7. £4.15 each",
        until: "1st November 2026",
      }),
    ]);
  });
});

it("standardises every price to pence per 100 ml", () => {
  expect(pencePer100ml(8, { count: 24, ml: 330 })).toBeCloseTo(10.1, 1);
  expect(pencePer100ml(2, { count: 1, ml: 2000 })).toBe(10);
});

const everything = () => [
  ...parseTesco(fixture("tesco.html")),
  ...parseSainsburys(json("sainsburys.json")),
  ...parseAsda(json("asda.json")),
  ...parseLidl(json("lidl.json")),
  ...parseDeals(fixture("spar.html"), "Spar"),
];
const section = (report: string, heading: string) =>
  report.split("\n\n").find((block) => block.includes(heading)) ?? "";

it("leads with the cheapest option overall and the cheapest without a loyalty card", () => {
  const report = priceReport(everything(), {
    failed: [],
    now: new Date("2026-10-27T08:00:00Z"),
  });
  expect(report.split("\n")[0]).toBe(
    "<b>🥤 Pepsi Max · best price per 100 ml</b>",
  );
  expect(section(report, "Cheapest overall")).toContain(
    "Sainsbury's · 2L bottle — <b>8.8p</b>/100ml",
  );
  expect(section(report, "without a loyalty card")).toContain(
    "Spar · 1.25L bottle — <b>under 9.8p</b>/100ml",
  );
});

it("ranks can multipacks and bottles separately, one numbered entry each", () => {
  const report = priceReport(everything(), {
    failed: [],
    now: new Date("2026-10-27T08:00:00Z"),
  });
  const cans = section(report, "Can multipacks").split("\n");
  expect(cans[1]).toBe("<b>1.</b> Tesco · 24×330ml — <b>10.1p</b>");
  expect(cans[2]).toBe(
    "     £8.00 Clubcard Price until 03/11/2026 · £11.75 standard (14.8p)",
  );
  expect(cans[3]).toBe("<b>2.</b> Sainsbury's · 24×330ml — <b>10.7p</b>");
  expect(section(report, "Bottles")).toContain("Asda · 2L bottle");
});

it("covers Spar and Eurospar deals, saying plainly when there is no Pepsi Max deal", () => {
  const report = priceReport(everything(), {
    failed: [],
    now: new Date("2026-10-27T08:00:00Z"),
  });
  const henderson = section(report, "SPAR · EUROSPAR");
  expect(henderson).toContain("SPAR: 1.25L —");
  expect(henderson).toContain("EUROSPAR: no Pepsi Max deal this period");
  expect(report).not.toMatch(/vivo/i);
});

it("escapes shop text so it cannot break Telegram formatting", () => {
  const [tesco] = parseTesco(fixture("tesco.html"));
  expect(
    priceReport([{ ...tesco!, note: "Buy <2> & save" }], {
      failed: [],
      now: new Date(),
    }),
  ).toContain("Buy &lt;2&gt; &amp; save");
});

it("says which shops could not be checked instead of hiding them", () => {
  expect(
    priceReport([], {
      failed: ["Asda"],
      now: new Date("2026-10-27T08:00:00Z"),
    }),
  ).toContain("Couldn't check: Asda");
});
