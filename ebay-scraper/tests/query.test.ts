import { describe, expect, it } from "vitest";
import { buildSearchUrl, searchQuerySchema } from "../src/query.js";

describe("search query boundary", () => {
  it("applies marketplace and pagination defaults", () => {
    const query = searchQuerySchema.parse({ query: "  charizard  " });
    expect(query).toMatchObject({ query: "charizard", domain: "com", page: 1 });
    const url = buildSearchUrl(query);
    expect(url.origin).toBe("https://www.ebay.com");
    expect(url.searchParams.get("_nkw")).toBe("charizard");
    expect(url.searchParams.has("_pgn")).toBe(false);
  });

  it("maps all filters without dropping zero prices or false booleans", () => {
    const url = buildSearchUrl(
      searchQuerySchema.parse({
        query: "PSA & base set",
        domain: "co.uk",
        page: "2",
        per_page: "120",
        category_id: "183454",
        sort_by: "price_low_to_high",
        condition: "used",
        buying_format: "buy_it_now",
        min_price: "0",
        max_price: "500.50",
        free_shipping: "false",
        location: "domestic",
        language: "english",
      }),
    );
    expect(url.origin).toBe("https://www.ebay.co.uk");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      _nkw: "PSA & base set",
      _pgn: "2",
      _ipg: "120",
      _sacat: "183454",
      _sop: "2",
      LH_ItemCondition: "3000",
      LH_BIN: "1",
      _udlo: "0",
      _udhi: "500.5",
      LH_PrefLoc: "1",
      Language: "English",
    });
    expect(url.searchParams.has("LH_FS")).toBe(false);
  });

  it.each([
    {},
    { query: " " },
    { query: "x", domain: "com.evil.test" },
    { query: "x", page: "0" },
    { query: "x", page: "1.5" },
    { query: "x", per_page: "100" },
    { query: "x", free_shipping: "yes" },
    { query: "x", min_price: "-1" },
    { query: "x", min_price: "20", max_price: "10" },
    { query: "x", url: "http://127.0.0.1" },
    { query: ["x", "y"] },
    { query: "x", page: "Infinity" },
    { query: "x", category_id: "../admin" },
  ])("rejects invalid input %j", (input) => {
    expect(searchQuerySchema.safeParse(input).success).toBe(false);
  });

  it.each([
    ["auction", "LH_Auction"],
    ["best_offer", "LH_BO"],
  ])("maps the %s buying format", (format, key) => {
    const url = buildSearchUrl(
      searchQuerySchema.parse({
        query: "x",
        buying_format: format,
        free_shipping: "true",
      }),
    );
    expect(url.searchParams.get(key)).toBe("1");
    expect(url.searchParams.get("LH_FS")).toBe("1");
  });
});

it("uses canonical first-page URLs and preserves spaces, literal plus signs and slash searches", () => {
  const url = buildSearchUrl(
    searchQuerySchema.parse({
      query: "C++ charizard 4/102",
      domain: "co.uk",
      sort_by: "newly_listed",
    }),
  );
  expect(url.href).toContain("C%2B%2B%20charizard%204%2F102");
  expect(url.searchParams.get("_nkw")).toBe("C++ charizard 4/102");
  expect(url.searchParams.get("_sop")).toBe("10");
  expect(url.searchParams.has("_pgn")).toBe(false);
});

it("preserves the completed-search URL format verified against the live site", () => {
  const url = buildSearchUrl({
    ...searchQuerySchema.parse({ query: "charizard base", domain: "co.uk" }),
    completed: true,
    sold_only: true,
  });
  expect(url.searchParams.get("_pgn")).toBe("1");
  expect(url.href).toContain("_nkw=charizard+base&_pgn=1");
  expect(url.searchParams.get("LH_Sold")).toBe("1");
});
