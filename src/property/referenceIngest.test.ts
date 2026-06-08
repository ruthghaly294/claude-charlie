import { describe, it, expect, vi } from "vitest";
import { createDb } from "@/db/client";
import { postcodeValues, valuationCoefs } from "@/db/schema";
import { ingestReference, loadCoefMap } from "./referenceIngest";

const HTML = `<html><script>latest_data_quarter = '2025_Q3';</script></html>`;
const PPSQM = `Postcode,longitude,latitude,n_properties,mean_val,mean_size,mean_price_per_sq_m,ppsqm_delta,html_colour,popup_text
BT5 6AB,-5.9,54.5,40,210000.0,95,2210.0,300.0,#fff,"in east"
BT9 7AA,-5.93,54.58,30,330000.0,110,3000.0,800.0,#fff,"in south"
BT1 1GJ,-5.93,54.6,34,126340.0,62,2086.0,258.3,#fff,"city centre — not tracked"`;
const COEFS = `coef,value_mean,value_lower,value_upper
area_m2,-4.10325,-4.3,-3.9
BT5 6AB,2210.0,2100.0,2300.0`;

function fakeFetch() {
  return vi.fn((url: unknown) => {
    const u = String(url);
    const body = u.endsWith("/")
      ? HTML
      : u.includes("ppsqm_")
        ? PPSQM
        : u.includes("calculator_coefs")
          ? COEFS
          : "";
    return Promise.resolve(new Response(body, { status: 200 }));
  });
}

describe("ingestReference", () => {
  it("stores only tracked-area postcodes and all coefficients", async () => {
    const db = createDb(":memory:");
    const fetchImpl = fakeFetch() as unknown as typeof fetch;
    const sum = await ingestReference(db, { fetchImpl });

    expect(sum.quarter).toBe("2025_Q3");
    expect(sum.postcodes).toBe(2); // BT5 + BT9 kept, BT1 dropped (not tracked)

    const pcs = db.select().from(postcodeValues).all();
    expect(pcs.map((p) => p.postcode).sort()).toEqual(["BT5 6AB", "BT9 7AA"]);
    expect(pcs.find((p) => p.postcode === "BT5 6AB")?.meanPpsqm).toBe(2210);

    expect(db.select().from(valuationCoefs).all().length).toBe(2);
    expect(loadCoefMap(db).get("BT5 6AB")).toBe(2210);
  });

  it("is idempotent", async () => {
    const db = createDb(":memory:");
    const fetchImpl = fakeFetch() as unknown as typeof fetch;
    await ingestReference(db, { fetchImpl });
    await ingestReference(db, { fetchImpl });
    expect(db.select().from(postcodeValues).all()).toHaveLength(2);
  });
});
