import { describe, expect, it } from "vitest";
import { distanceKm, inRadius, eastBelfast } from "../../src/facebook/geo.js";
describe("Facebook collection radius", () => {
  it("uses a labelled East Belfast centre and kilometres", () => {
    expect(eastBelfast.name).toContain("East Belfast");
    expect(distanceKm(eastBelfast, eastBelfast)).toBe(0);
    expect(
      distanceKm(eastBelfast, { latitude: 54.5924, longitude: -5.6909 }),
    ).toBeGreaterThan(10);
    expect(
      distanceKm(eastBelfast, { latitude: 54.5924, longitude: -5.6909 }),
    ).toBeLessThan(15);
    expect(
      inRadius(eastBelfast, { latitude: 53.3498, longitude: -6.2603 }, 40),
    ).toBe(false);
  });
  it("filters using unrounded distance, not a display rounded to 40 km", () => {
    const longitude = ((40.04 / 6371) * 180) / Math.PI;
    expect(
      inRadius({ latitude: 0, longitude: 0 }, { latitude: 0, longitude }, 40),
    ).toBe(false);
    expect(
      inRadius(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: ((39.96 / 6371) * 180) / Math.PI },
        40,
      ),
    ).toBe(true);
  });
  it("does not call unknown or invalid locations local", () => {
    expect(inRadius(eastBelfast, null, 40)).toBe(false);
    expect(() =>
      distanceKm(eastBelfast, { latitude: 91, longitude: 0 }),
    ).toThrow();
    expect(() => inRadius(eastBelfast, eastBelfast, -1)).toThrow();
  });
});
