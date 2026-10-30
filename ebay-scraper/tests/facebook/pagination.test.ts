import { expect, it } from "vitest";
import { drainFacebookSearch } from "../../src/facebook/pagination.js";
it("keeps loading beyond two scrolls until results settle", async () => {
  const counts = [24, 48, 72, 96, 96, 96, 96];
  let calls = 0;
  await drainFacebookSearch(async () => counts[calls++] ?? 96);
  expect(calls).toBe(7);
});
it("reports an incomplete scan when the safety limit is reached", async () => {
  let count = 0;
  await expect(
    drainFacebookSearch(async () => ++count, 4),
  ).rejects.toMatchObject({ code: "UPSTREAM_INCOMPLETE_RESULTS" });
});

it("reports a stalled feed that explicitly says more results are available", async () => {
  let calls = 0;
  await expect(
    drainFacebookSearch(async () => {
      calls++;
      return { count: 24, hasMore: true };
    }),
  ).rejects.toMatchObject({ code: "UPSTREAM_INCOMPLETE_RESULTS" });
  expect(calls).toBe(4);
});

it("recognizes the latest search-feed continuation without borrowing another feed", async () => {
  const { searchHasMore } = await import("../../src/facebook/parser.js");
  expect(
    searchHasMore([
      '{"data":{"marketplace_search":{"feed_units":{"page_info":{"has_next_page":true}}}}}',
      '{"data":{"node":{"__typename":"MarketplaceSearchFeed","page_info":{"has_next_page":false}},"unrelated":{"page_info":{"has_next_page":true}}}}',
    ]),
  ).toBe(false);
});

it("stops at an explicit no-results story instead of paginating unrelated recommendations", async () => {
  const { searchHasMore } = await import("../../src/facebook/parser.js");
  expect(
    searchHasMore([
      '{"data":{"marketplace_search":{"feed_units":{"page_info":{"has_next_page":true},"edges":[{"node":{"__typename":"MarketplaceSearchFeedNoResults","story_type":"SERP_NO_RESULTS"}}]}}}}',
    ]),
  ).toBe(false);
});
