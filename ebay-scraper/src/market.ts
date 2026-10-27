import type { Listing } from "./contract.js";
export type MarketProfile = "chairs" | "charizard_psa9_base";
export type Observation = { itemId: string; price: number; soldAt: number };
export function comparable(profile: MarketProfile, listing: Listing): boolean {
  const title = listing.title.toLowerCase();
  if (
    /\b(proxy|replica|custom|reprint|autographed|autograph|signed|ccc|lot|bundle|pair|2x|set of|cover|cushion|miniature|repair|broken)\b/.test(
      title,
    )
  )
    return false;
  if (profile === "chairs")
    return (
      /chesterfield/.test(title) &&
      /captain|gainsborough/.test(title) &&
      /chair/.test(title) &&
      !/\b(pu|vinyl|faux|synthetic|leatherette)\b/.test(title)
    );
  return (
    /charizard/.test(title) &&
    /\b(english|unlimited|1999)\b/.test(title) &&
    /\bpsa\s*9\b/.test(title) &&
    /\b4\s*\/\s*102\b/.test(title) &&
    !/\b(1st|first|shadowless|japanese|jpn|german|french|italian|spanish|dutch|korean|chinese|portuguese|celebrations|evolutions|base set 2|psa\s*(?:8|10))\b/.test(
      title,
    )
  );
}
export function saleObservation(
  listing: Listing,
  now: number,
): Observation | null {
  if (
    listing.is_sold !== true ||
    listing.best_offer_accepted ||
    !listing.sale_price ||
    listing.sale_price.currency !== "GBP" ||
    !listing.ended_date
  )
    return null;
  // Only explicit English dates with a year are used for historical windows.
  if (
    !/^(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})$/.test(
      listing.ended_date.trim(),
    )
  )
    return null;
  const soldAt = Date.parse(listing.ended_date + " 00:00:00 GMT");
  if (!Number.isFinite(soldAt) || soldAt > now + 86400000) return null;
  return { itemId: listing.item_id, price: listing.sale_price.value, soldAt };
}
function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}
export function marketSummary(
  observations: readonly Observation[],
  days: number,
  now: number,
) {
  const selected = observations.filter(
    (r) => r.soldAt >= now - days * 86400000 && r.soldAt <= now,
  );
  const prices = selected.map((r) => r.price).sort((a, b) => a - b);
  const round = (n: number | null): number | null =>
    n === null ? null : Math.round(n * 100) / 100;
  return {
    requestedDays: days,
    currency: "GBP",
    coverage: "sampled" as const,
    count: prices.length,
    average: round(
      prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
    ),
    median: round(quantile(prices, 0.5)),
    floor: prices[0] ?? null,
    ceiling: prices.at(-1) ?? null,
    typicalLow: round(quantile(prices, 0.25)),
    typicalHigh: round(quantile(prices, 0.75)),
    oldestSale: selected.length
      ? new Date(Math.min(...selected.map((r) => r.soldAt))).toISOString()
      : null,
    newestSale: selected.length
      ? new Date(Math.max(...selected.map((r) => r.soldAt))).toISOString()
      : null,
  };
}
export type MarketSummary = ReturnType<typeof marketSummary>;
export function potentialDeal(
  listing: Listing,
  stats: MarketSummary,
): { totalPrice: number; discountPercent: number } | null {
  if (
    stats.count < 5 ||
    stats.median === null ||
    stats.typicalLow === null ||
    !listing.price ||
    listing.price.currency !== "GBP" ||
    listing.is_auction === true
  )
    return null;
  const shipping =
    listing.free_shipping === true
      ? 0
      : listing.shipping_cost?.currency === "GBP"
        ? listing.shipping_cost.value
        : null;
  if (shipping === null) return null;
  const totalPrice = listing.price.value + shipping;
  if (totalPrice > stats.typicalLow || totalPrice > stats.median * 0.8)
    return null;
  return {
    totalPrice,
    discountPercent: Math.round((1 - totalPrice / stats.median) * 100),
  };
}
export function researchText(profile: string, stats: MarketSummary): string {
  const money = (v: number | null) =>
    v === null ? "unknown" : `£${v.toFixed(2)}`;
  return `${profile === "chairs" ? "Chesterfield captain chairs" : profile === "charizard_psa9_base" ? "Charizard Base Set 4/102 PSA 9 (English unlimited)" : profile}\n${stats.requestedDays}-day sold sample: ${stats.count} ${profile === "chairs" || profile === "charizard_psa9_base" ? "comparable" : "search-matched"} disclosed prices\nAverage ${money(stats.average)} · median ${money(stats.median)}\nObserved floor ${money(stats.floor)} · ceiling ${money(stats.ceiling)}\nTypical range ${money(stats.typicalLow)}–${money(stats.typicalHigh)}\n${stats.oldestSale ? `Oldest observed sale: ${stats.oldestSale.slice(0, 10)}` : "No dated sold comparables yet"}\nSampled results, not complete market history. Sold prices exclude delivery; accepted offers with hidden amounts excluded.`;
}
