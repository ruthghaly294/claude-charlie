import { expect, it } from "vitest";
import { parseListingDescription } from "../../src/facebook/parser.js";

// Shape observed on a live listing page on 2026-10-30, trimmed.
const page = (id: string) => [
  JSON.stringify({
    require: [
      {
        id: "999",
        redacted_description: { text: "Recommended item, not this one" },
      },
      {
        id,
        redacted_description: {
          text: "Grey and white (glass top) table, with 2 chairs.\n\nCOLLECTION ONLY.",
        },
        creation_time: 1793280465,
      },
    ],
  }),
];

it("reads the seller's description for the listing itself, not recommended items", () => {
  expect(
    parseListingDescription(page("1119629597724483"), "1119629597724483"),
  ).toBe(
    "Grey and white (glass top) table, with 2 chairs.\n\nCOLLECTION ONLY.",
  );
});

it("returns null when the page has no description for the listing", () => {
  expect(parseListingDescription(page("1"), "2")).toBeNull();
});
