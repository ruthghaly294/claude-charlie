import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  parseListingCoordinates,
  parseSearchPayloads,
} from "../../src/facebook/parser.js";

const capture = (name: string): { path: string; payloads: string[] } =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"),
  );

it("reads listings from a captured signed-in Marketplace search page", () => {
  const listings = parseSearchPayloads(
    capture("facebook-search.json").payloads,
  );
  expect(listings).toHaveLength(4);
  expect(listings[1]).toEqual({
    id: "1839478290721633",
    title: "Black chesterfield single chair",
    url: "https://www.facebook.com/marketplace/item/1839478290721633/",
    image: expect.stringMatching(/^https:\/\/scontent-[^/]+\.fbcdn\.net\//),
    price: { value: 50, currency: "GBP", symbol: "£", raw: "£50" },
    locationName: "Newtownabbey",
    coordinates: null,
    availability: "available",
    listedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
  });
});

it("reports sold and pending listings and ignores duplicates across payloads", () => {
  const [payload] = capture("facebook-search.json").payloads;
  const changed = payload!
    .replace('"is_sold":false', '"is_sold":true')
    .replace(
      /"is_pending":false(?![\s\S]*"is_pending":false)/,
      '"is_pending":true',
    );
  const listings = parseSearchPayloads([changed, payload!]);
  expect(listings).toHaveLength(4);
  expect(listings[0]?.availability).toBe("sold");
  expect(listings[3]?.availability).toBe("pending");
});

it("takes the listing's own coordinates, not the viewer's search location", () => {
  expect(
    parseListingCoordinates(
      capture("facebook-detail.json").payloads,
      "1083292931250072",
    ),
  ).toEqual({ latitude: 54.577331542969, longitude: -6.0369873046875 });
  expect(
    parseListingCoordinates(capture("facebook-detail.json").payloads, "999"),
  ).toBeNull();
});

it("treats Facebook's Free price label as a £0 asking price", () => {
  const [payload] = capture("facebook-search.json").payloads;
  const free = payload!.replace(
    '"formatted_amount":"£50","amount_with_offset_in_currency":"6650","amount":"50.00"',
    '"formatted_amount":"FREE","amount_with_offset_in_currency":"0","amount":"0.00"',
  );
  expect(parseSearchPayloads([free])[1]?.price).toEqual({
    value: 0,
    currency: "GBP",
    symbol: "£",
    raw: "Free",
  });
});
