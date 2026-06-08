import { describe, it, expect } from "vitest";
import {
  parseCsv,
  parsePpsqmCsv,
  parseCoefsCsv,
  estimatePrice,
  estimateFromPpsqm,
  dealMetrics,
} from "./valuation";

describe("parseCsv", () => {
  it("handles quoted fields with embedded commas", () => {
    const rows = parseCsv('a,b,c\n1,"x,y",3\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "x,y", "3"],
    ]);
  });
});

const PPSQM = `Postcode,longitude,latitude,n_properties,mean_val,mean_size,mean_price_per_sq_m,ppsqm_delta,html_colour,popup_text
BT5 6AB,-5.9,54.5,40,210000.0,95,2210.0,300.0,#fff,"<b>BT5 6AB</b><br/>Mean value £210,000"
BT9 7AA,-5.93,54.58,30,330000.0,110,3000.0,800.0,#fff,"<b>BT9 7AA</b>"`;

const COEFS = `coef,value_mean,value_lower,value_upper
area_lt_60_01,215.7,179.3,252.2
area_m2,-4.10325,-4.3,-3.9
area_squared,0.00429,0.0039,0.0047
has_garage_01,160.0,148.9,171.2
has_garden_01,219.5,201.9,237.0
BT5 6AB,2210.0,2100.0,2300.0`;

describe("parsePpsqmCsv", () => {
  it("parses postcode value rows", () => {
    const rows = parsePpsqmCsv(PPSQM);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      postcode: "BT5 6AB",
      meanVal: 210000,
      meanSize: 95,
      meanPpsqm: 2210,
    });
  });
});

describe("estimatePrice", () => {
  it("computes fair value from the calculator coefficients", () => {
    const coefs = new Map(parseCoefsCsv(COEFS).map((c) => [c.coef, c.valueMean]));
    // 100 m² house in BT5 6AB, with a garden
    const price = estimatePrice(coefs, {
      postcode: "BT5 6AB",
      sizeSqm: 100,
      hasGarden: true,
    });
    // ppsqm = 2210 - 4.10325*100 + 0.00429*10000 + 219.5 ≈ 2061.8 → ×100
    expect(price).toBe(206207);
  });

  it("returns null for an unknown postcode", () => {
    const coefs = new Map(parseCoefsCsv(COEFS).map((c) => [c.coef, c.valueMean]));
    expect(estimatePrice(coefs, { postcode: "BT99 9ZZ", sizeSqm: 100 })).toBeNull();
  });
});

describe("estimateFromPpsqm", () => {
  it("multiplies mean £/m² by size", () => {
    expect(estimateFromPpsqm(2210, 100)).toBe(221000);
  });
});

describe("dealMetrics", () => {
  it("flags an asking price below fair value as a positive deal", () => {
    const m = dealMetrics(180000, 206207);
    expect(m.dealPct).toBeGreaterThan(0);
    expect(m.dealScore).toBe(13);
  });
  it("flags overpriced as negative", () => {
    expect(dealMetrics(250000, 206207).dealScore).toBeLessThan(0);
  });
});
