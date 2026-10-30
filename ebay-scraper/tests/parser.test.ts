import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSearchHtml, parseMoney } from "../src/parser.js";
import { searchQuerySchema } from "../src/query.js";
import { searchResponseSchema } from "../src/contract.js";

export const html = readFileSync(
  new URL("./fixtures/search.html", import.meta.url),
  "utf8",
);
const query = searchQuerySchema.parse({ query: "charizard", domain: "co.uk" });
const now = new Date("2026-10-26T21:30:57.873Z");

describe("HTML to captured response contract", () => {
  it("parses real Chrome HTML without mixing sponsored carousel cards into the results", () => {
    const realHtml = readFileSync(
      new URL("./fixtures/chrome-search.html", import.meta.url),
      "utf8",
    );
    const data = parseSearchHtml(realHtml, query, now);
    expect(data.results.map((item) => item.item_id)).toEqual([
      "940042554020",
      "880035372489",
    ]);
    expect(data.results[0]).toMatchObject({
      price: { value: 156.69 },
      shipping_cost: { value: 3.92 },
    });
    expect(data.pagination.has_more).toBe(true);
  });
  it("rejects unexpected response fields instead of silently hiding contract differences", () => {
    const data = parseSearchHtml(html, query, now);
    expect(
      searchResponseSchema.safeParse({ ...data, unexpected: true }).success,
    ).toBe(false);
    expect(
      searchResponseSchema.safeParse({
        ...data,
        results: data.results.map((item) => ({ ...item, unexpected: true })),
      }).success,
    ).toBe(false);
  });
  it("extracts public IDs, cleans URLs, preserves price and shipping, and excludes duplicates and recommendations", () => {
    const data = parseSearchHtml(html, query, now);
    expect(data.results).toHaveLength(2);
    expect(data.results[0]).toMatchObject({
      position: 1,
      item_id: "940042554020",
      product_id: "10052760905",
      url: "https://www.ebay.co.uk/itm/940042554020",
      condition: "Pre-owned",
      buying_format: "Best Offer",
      is_auction: false,
      price: { value: 156.69, currency: "GBP", symbol: "£", raw: "£156.69" },
      shipping_cost: { value: 3.92, currency: "GBP" },
      free_shipping: null,
      watchers: 47,
      program_badge: "Authenticity Guarantee",
      seller_name: null,
    });
    expect(data.results[1]).toMatchObject({
      title: "Charizard Holo PSA 5 & swirl",
      is_auction: true,
      bids: 3,
      current_bid: { value: 289 },
      free_shipping: true,
      shipping_cost: null,
      time_left: "1h 20m left",
      image: "https://i.ebayimg.com/images/g/fixture2/s-l140.webp",
    });
    expect(data.pagination).toEqual({
      current_page: 1,
      per_page: null,
      returned: 2,
      total_results: 1800,
      total_pages: null,
      has_more: true,
    });
    expect(data.scraped_at).toBe(now.toISOString());
    expect(data.scraped_utc).toBe(now.getTime() / 1000);
    expect(searchResponseSchema.safeParse(data).success).toBe(true);
  });

  it("uses exactly the listing fields seen in the supplied HAR", () => {
    const captured: unknown = JSON.parse(
      readFileSync(
        new URL("./fixtures/captured-response.json", import.meta.url),
        "utf8",
      ),
    );
    const reference = searchResponseSchema.parse(captured);
    expect(
      Object.keys(parseSearchHtml(html, query, now).results[0] ?? {}).sort(),
    ).toEqual(Object.keys(reference.results[0] ?? {}).sort());
  });

  it("supports legacy cards and locale-sensitive prices", () => {
    const legacy = `<h1 class="srp-controls__count-heading">1 Ergebnis</h1><ul class="srp-results"><li class="s-item"><a class="s-item__link" href="https://www.ebay.de/itm/123456789012"><h3 class="s-item__title"><span class="clipped">Neues Angebot</span>Charizard</h3></a><span class="s-item__price">1.234,56 EUR</span><span class="s-item__shipping">+4,95 EUR Versand</span></li></ul>`;
    const data = parseSearchHtml(
      legacy,
      searchQuerySchema.parse({ query: "charizard", domain: "de" }),
      now,
    );
    expect(data.results[0]).toMatchObject({
      title: "Charizard",
      price: { value: 1234.56, currency: "EUR" },
      shipping_cost: { value: 4.95 },
      is_auction: null,
    });
    expect(data.pagination.has_more).toBe(false);
  });

  it.each(["<h1>Access Denied</h1>", "<title>Pardon Our Interruption</title>"])(
    "rejects block pages rather than claiming zero results: %s",
    (body) => {
      expect(() => parseSearchHtml(body, query, now)).toThrow(/blocked/i);
    },
  );

  it("distinguishes a valid zero-result page from changed markup", () => {
    expect(
      parseSearchHtml(
        '<h1 class="srp-controls__count-heading">0 results for absent</h1>',
        query,
        now,
      ).results,
    ).toEqual([]);
    expect(() =>
      parseSearchHtml("<html><h1>A new layout</h1></html>", query, now),
    ).toThrow(/markup/i);
    expect(() =>
      parseSearchHtml(
        '<h1 class="srp-controls__count-heading">60 results</h1><ul class="srp-results"><li class="s-card">unrecognized listing</li></ul>',
        query,
        now,
      ),
    ).toThrow(/markup/i);
  });

  it("never accepts external or executable item URLs", () => {
    const poisoned = html.replaceAll(
      "https://www.ebay.co.uk/itm/",
      "https://evil.test/itm/",
    );
    expect(() => parseSearchHtml(poisoned, query, now)).toThrow(/markup/i);
  });

  it("does not return suggested listings from a zero-exact-results page", () => {
    const emptyWithSuggestions = html.replace("1,800", "0");
    const data = parseSearchHtml(emptyWithSuggestions, query, now);
    expect(data.results).toEqual([]);
    expect(data.pagination.has_more).toBe(false);
  });

  it("honors the current page and explicit page size", () => {
    const paged = parseSearchHtml(
      html,
      searchQuerySchema.parse({
        query: "charizard",
        domain: "co.uk",
        page: "2",
        per_page: "60",
      }),
      now,
    );
    expect(paged.pagination).toMatchObject({
      current_page: 2,
      per_page: 60,
      total_pages: 30,
      has_more: false,
    });
  });

  it("does not infer exact total pages from approximate totals", () => {
    const data = parseSearchHtml(
      html.replace("1,800", "1,800+"),
      searchQuerySchema.parse({ query: "x", per_page: "60" }),
      now,
    );
    expect(data.pagination.total_pages).toBeNull();
  });
});

describe("money normalization", () => {
  it.each([
    ["£1,234.56", "co.uk", 1234.56, "GBP"],
    ["1.234,56 EUR", "de", 1234.56, "EUR"],
    ["1 234,56 €", "fr", 1234.56, "EUR"],
    ["CHF 1’234.50", "ch", 1234.5, "CHF"],
    ["US $25.00", "co.uk", 25, "USD"],
    ["AU $25.00", "com.au", 25, "AUD"],
  ])("parses %s", (raw, domain, value, currency) => {
    const marketQuery = searchQuerySchema.parse({ query: "x", domain });
    expect(parseMoney(raw, marketQuery.domain)).toMatchObject({
      value,
      currency,
      raw,
    });
  });
  it.each([
    "£10.00 to £20.00",
    "Contact seller",
    "Free delivery",
    "123 bananas",
  ])("does not invent a single price from %s", (raw) => {
    expect(parseMoney(raw, "co.uk")).toBeNull();
  });
});

describe("eBay error-page classification", () => {
  it("reports the observed generic eBay error as temporary, separately from a security challenge", () => {
    const page =
      '<title>Error Page | eBay</title><h1>SORRY</h1><div id="error-info">Something went wrong on our end. Please go back and try again.</div>';
    expect(() => parseSearchHtml(page, query, now)).toThrowError(
      expect.objectContaining({
        code: "UPSTREAM_TEMPORARY_ERROR",
        statusCode: 503,
      }),
    );
    expect(() =>
      parseSearchHtml(
        '<title>Pardon our interruption</title><form id="captcha_form"></form>',
        query,
        now,
      ),
    ).toThrowError(expect.objectContaining({ code: "UPSTREAM_BLOCKED" }));
  });
});
