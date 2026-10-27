import { describe, it, expect } from "vitest";
import { comparable, marketSummary, potentialDeal } from "../src/market.js";
import { listingSchema } from "../src/contract.js";
const card = (title: string) =>
  listingSchema.parse({
    position: 1,
    item_id: "123",
    title,
    url: "https://www.ebay.co.uk/itm/123",
    is_sold: true,
    ended_date: "26 Oct 2026",
    sale_price: { value: 200, currency: "GBP", symbol: "£", raw: "£200" },
    price: { value: 100, currency: "GBP", symbol: "£", raw: "£100" },
    free_shipping: true,
    is_auction: false,
  });
describe("comparable market research", () => {
  it("separates grades and editions, and excludes replicas and bundles", () => {
    expect(
      comparable(
        "charizard_psa9_base",
        card("1999 Base Set Charizard 4/102 PSA 9"),
      ),
    ).toBe(true);
    for (const title of [
      "Charizard 4/102 PSA 10",
      "Charizard 4/102 PSA 9 1st Edition",
      "Charizard 4/102 PSA 9 Shadowless",
      "Charizard 4/102 PSA 9 Japanese",
      "Charizard 4/102 PSA 9 proxy",
      "1999 Charizard 4/102 PSA 9 Autographed",
      "1999 Charizard 4/102 PSA 9 Dutch",
      "Charizard 4/102 CCC PSA 9",
    ])
      expect(comparable("charizard_psa9_base", card(title))).toBe(false);
    expect(
      comparable("chairs", card("Chesterfield captain chair PU leather")),
    ).toBe(false);
  });
  it("reports sampled time windows and does not invent a year of history", () => {
    const now = Date.UTC(2026, 9, 27);
    const observations = Array.from({ length: 5 }, (_, i) => ({
      itemId: String(i),
      price: 100 + i * 50,
      soldAt: now - 86400000 * (i + 1),
    }));
    const stats = marketSummary(observations, 90, now);
    expect(stats.count).toBe(5);
    expect(stats.median).toBe(200);
    expect(stats.floor).toBe(100);
    expect(stats.ceiling).toBe(300);
    expect(stats.coverage).toBe("sampled");
    expect(marketSummary(observations, 365, now).count).toBe(5);
    const older = [
      { itemId: "older", price: 150, soldAt: now - 120 * 86400000 },
    ];
    expect(marketSummary(older, 90, now).count).toBe(0);
    expect(marketSummary(older, 180, now).count).toBe(1);
  });
  it("requires enough sold comparables, disclosed shipping, and a fixed price for deal alerts", () => {
    const now = Date.UTC(2026, 9, 27);
    const observations = Array.from({ length: 5 }, (_, i) => ({
      itemId: String(i),
      price: 200 + i * 10,
      soldAt: now - 86400000,
    }));
    const stats = marketSummary(observations, 90, now);
    const listing = card("1999 Base Set Charizard 4/102 PSA 9");
    expect(potentialDeal(listing, stats)?.discountPercent).toBeGreaterThan(20);
    expect(potentialDeal({ ...listing, is_auction: true }, stats)).toBeNull();
    expect(
      potentialDeal(
        { ...listing, free_shipping: false, shipping_cost: null },
        stats,
      ),
    ).toBeNull();
    expect(potentialDeal(listing, marketSummary([], 90, now))).toBeNull();
  });
});
