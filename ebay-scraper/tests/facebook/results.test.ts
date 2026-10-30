import { expect, it } from "vitest";
import { facebookListingSchema } from "../../src/facebook/contract.js";
import { localListings, relevantTitle } from "../../src/facebook/results.js";
import { eastBelfast } from "../../src/facebook/geo.js";
const row = facebookListingSchema.parse({
  id: "123",
  title: "Chesterfield Captains Chair",
  url: "https://www.facebook.com/marketplace/item/123/",
  image: null,
  price: { value: 150, currency: "GBP", symbol: "£", raw: "£150" },
  locationName: "East Belfast",
  coordinates: eastBelfast,
  availability: "available",
  listedAt: null,
});
it("keeps only relevant available items with verifiable local coordinates", () => {
  const result = localListings(
    [
      row,
      { ...row, id: "124", coordinates: null },
      {
        ...row,
        id: "125",
        coordinates: { latitude: 53.3498, longitude: -6.2603 },
      },
      { ...row, id: "126", title: "Chesterfield sofa" },
      { ...row, id: "127", availability: "sold" },
    ],
    { query: "Chesterfield captain chair", ...eastBelfast, radiusKm: 40 },
  );
  expect(result.results).toHaveLength(1);
  expect(result.results[0]?.location).toContain("0.0 km (straight-line)");
  expect(result.unknownLocation).toBe(1);
  expect(result.outsideRadius).toBe(1);
  expect(result.unrelated).toBe(1);
});
it("understands captain’s/chairs without alerting for unrelated furniture", () => {
  expect(
    relevantTitle(
      "Chesterfield captain's chairs",
      "Leather Chesterfield Captains Chair",
    ),
  ).toBe(true);
  expect(relevantTitle("Chesterfield captain chair", "Chesterfield Sofa")).toBe(
    false,
  );
});
it("matches singular and plural words either way", () => {
  expect(relevantTitle("free plants", "Free plant cuttings")).toBe(true);
  expect(relevantTitle("round table", "Round oak tables x2")).toBe(true);
  expect(relevantTitle("round table", "Square table")).toBe(false);
});
