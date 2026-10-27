import { describe, expect, it } from "vitest";
import {
  buildSearchUrl,
  completedQuerySchema,
  searchQuerySchema,
} from "../src/query.js";
import { parseSearchHtml } from "../src/parser.js";
import { buildApp } from "../src/server.js";

const html = `<h1 class="srp-controls__count-heading">2 results</h1><ul class="srp-results">
<li class="s-card"><div class="s-card__caption">Sold 19 Oct 2026</div><a href="https://www.ebay.co.uk/itm/123456789012"><h3 class="s-card__title">Chesterfield captain chair brown leather</h3></a><span class="s-card__price">£175.00</span><div class="s-card__attribute-row">Buy It Now</div></li>
<li class="s-card"><div class="s-card__caption">Ended 18 Oct 2026 · Not sold</div><a href="https://www.ebay.co.uk/itm/123456789013"><h3 class="s-card__title">Chesterfield captain office chair</h3></a><span class="s-card__price">£250.00</span></li>
</ul>`;

describe("completed listing search", () => {
  it("defaults to all completed items, keeping the active endpoint unchanged", () => {
    const query = completedQuerySchema.parse({
      query: "chesterfield captain chairs",
      domain: "co.uk",
    });
    const url = buildSearchUrl(query);
    expect(url.searchParams.get("LH_Complete")).toBe("1");
    expect(url.searchParams.has("LH_Sold")).toBe(false);
    expect(url.searchParams.get("_sop")).toBe("13");
    expect(
      searchQuerySchema.safeParse({ query: "chairs", sold_only: "true" })
        .success,
    ).toBe(false);
    expect(
      buildSearchUrl(
        searchQuerySchema.parse({ query: "chairs" }),
      ).searchParams.has("LH_Complete"),
    ).toBe(false);
  });
  it("maps sold-only filtering and preserves validation", () => {
    const url = buildSearchUrl(
      completedQuerySchema.parse({ query: "chairs", sold_only: "true" }),
    );
    expect(url.searchParams.get("LH_Sold")).toBe("1");
    expect(url.searchParams.get("LH_Complete")).toBe("1");
    expect(
      completedQuerySchema.safeParse({ query: "chairs", sold_only: "yes" })
        .success,
    ).toBe(false);
    expect(
      completedQuerySchema.safeParse({
        query: "chairs",
        min_price: "20",
        max_price: "10",
      }).success,
    ).toBe(false);
  });
  it("separates sold and unsold records and preserves visible end dates", () => {
    const data = parseSearchHtml(
      html,
      completedQuerySchema.parse({ query: "chairs", domain: "co.uk" }),
    );
    expect(data).toMatchObject({ completed: true, sold: false });
    expect(data.results).toHaveLength(2);
    expect(data.results[0]).toMatchObject({
      is_sold: true,
      sold_date: "19 Oct 2026",
      ended_date: "19 Oct 2026",
      sale_price: { value: 175 },
    });
    expect(data.results[1]).toMatchObject({
      is_sold: false,
      sold_date: null,
      ended_date: "18 Oct 2026",
      sale_price: null,
    });
  });
  it("does not return unsold rows from a sold-only search", () => {
    const data = parseSearchHtml(
      html,
      completedQuerySchema.parse({
        query: "chairs",
        domain: "co.uk",
        sold_only: "true",
      }),
    );
    expect(data.sold).toBe(true);
    expect(data.results.map((item) => item.item_id)).toEqual(["123456789012"]);
  });
  it("never invents an accepted Best Offer amount", () => {
    const offer = html.replace("Buy It Now", "Best offer accepted");
    const data = parseSearchHtml(
      offer,
      completedQuerySchema.parse({ query: "chairs", domain: "co.uk" }),
    );
    expect(data.results[0]).toMatchObject({
      price: { value: 175 },
      sale_price: null,
      best_offer_accepted: true,
    });
  });
  it("reads status across separate metadata rows and rejects struck-through sale prices", () => {
    const separate = html
      .replace(
        "Ended 18 Oct 2026 · Not sold",
        'Ended 18 Oct 2026</div><div class="s-card__attribute-row">Not sold',
      )
      .replace(
        'class="s-card__price">£175.00',
        'class="s-card__price STRIKETHROUGH">£175.00',
      );
    const data = parseSearchHtml(
      separate,
      completedQuerySchema.parse({ query: "chairs", domain: "co.uk" }),
    );
    expect(data.results[0]?.sale_price).toBeNull();
    expect(data.results[1]?.is_sold).toBe(false);
  });
  it("does not mistake active listings for completed results", () => {
    const active = html.replaceAll(
      /<div class="s-card__caption">.*?<\/div>/g,
      "",
    );
    expect(() =>
      parseSearchHtml(
        active,
        completedQuerySchema.parse({ query: "chairs", domain: "co.uk" }),
      ),
    ).toThrow(/markup/i);
  });
  it("returns a sign-in-required error for an eBay login document", () => {
    expect(() =>
      parseSearchHtml(
        '<title>Sign in or Register | eBay</title><form action="https://signin.ebay.co.uk"><input name="userid"></form>',
        completedQuerySchema.parse({ query: "chairs" }),
      ),
    ).toThrow(/sign.in/i);
  });
  it("serves the completed route with the same request protections", async () => {
    const app = buildApp({
      apiKey: "test-key",
      fetchHtml: async (query) => {
        expect(query.completed).toBe(true);
        return html;
      },
    });
    try {
      expect(
        (await app.inject("/v1/ebay/completed?query=chairs")).statusCode,
      ).toBe(401);
      const reply = await app.inject({
        url: "/v1/ebay/completed?query=chesterfield%20captain%20chairs&domain=co.uk&sold_only=true",
        headers: { "x-api-key": "test-key" },
      });
      expect(reply.statusCode).toBe(200);
      expect(reply.json()).toMatchObject({
        completed: true,
        sold: true,
        results: [{ item_id: "123456789012" }],
      });
      expect(
        (
          await app.inject({
            url: "/v1/ebay/completed?query=chairs&sold_only=invalid",
            headers: { "x-api-key": "test-key" },
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
});
