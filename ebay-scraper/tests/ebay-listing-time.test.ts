import { expect, it } from "vitest";
import { parseEbayListingTime } from "../src/ebay-listing-time.js";
it("extracts listing start time tied to the requested item, never a recommendation or revision", () => {
  const html =
    '<script>{"itemId":"123456789012","startTime":"2026-10-28T11:48:00Z","lastModified":"2026-10-28T12:00:00Z"}</script><script>{"itemId":"999999999999","startTime":"2020-01-01T00:00:00Z"}</script>';
  expect(parseEbayListingTime(html, "123456789012")).toBe(
    "2026-10-28T11:48:00.000Z",
  );
  expect(parseEbayListingTime(html, "111111111111")).toBeNull();
});
it("does not infer timestamps from timezone-less dates, revisions or offer availability", () => {
  expect(
    parseEbayListingTime(
      '<script>{"itemId":"123456789012","startTime":"2026-10-28"}</script>',
      "123456789012",
    ),
  ).toBeNull();
  expect(
    parseEbayListingTime(
      "<div>Last updated 28 Oct 2026 12:00 GMT</div>",
      "123456789012",
    ),
  ).toBeNull();
});

it("finds nested listing start time within the matching item's data", () => {
  expect(
    parseEbayListingTime(
      '<script>{"itemId":"123456789012","listingInfo":{"startTime":1793188080000},"recommendations":[{"itemId":"999999999999","startTime":"2020-01-01T00:00:00Z"}]}</script>',
      "123456789012",
    ),
  ).toBe("2026-10-28T11:48:00.000Z");
});

it("reads eBay's live escaped listingId and startDate model", () => {
  const model = {
    listingId: "880059502027",
    bidCount: 0,
    auctionPossible: true,
    hasReservePrice: false,
    startDate: {
      value: "2026-10-28T16:30:01.000Z",
      formattedValue: "2026-10-28 09:30 AM MST",
    },
    endDate: { value: "2026-11-04T16:30:01.000Z" },
  };
  const html = `<script>bootstrap(${JSON.stringify(JSON.stringify(model))})</script>`;
  expect(parseEbayListingTime(html, "880059502027")).toBe(
    "2026-10-28T16:30:01.000Z",
  );
  expect(parseEbayListingTime(html, "999999999999")).toBeNull();
});

it("handles large bootstrap objects before the listing model without stalling", () => {
  const html = `<script>bootstrap({"unrelated":"${"x".repeat(100000)}"})</script><script>bootstrap({"listingId":"188151380608","startDate":{"value":"2026-03-12T18:34:34.000Z"}})</script>`;
  const started = performance.now();
  expect(parseEbayListingTime(html, "188151380608")).toBe(
    "2026-03-12T18:34:34.000Z",
  );
  expect(performance.now() - started).toBeLessThan(500);
});
