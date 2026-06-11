import { describe, it, expect, vi } from "vitest";
import { createDb } from "@/db/client";
import { lpsProperties } from "@/db/schema";
import {
  parseCapitalValue,
  parseSearchResults,
  parseDetailHtml,
  matchAddress,
  lookupLpsProperty,
  lpsEnrichment,
} from "./lpsLookup";

const SEARCH_JSON = JSON.stringify([
  {
    propertyId: "1012192",
    fullAddress:
      "Our Lady And St Patrick's College, 120 Gilnahirk Road, Gortgrib, Belfast BT5 7DL",
    capitalValue: "N/A",
  },
  {
    propertyId: "107183",
    fullAddress: "112 Gilnahirk Road, Tullycarnet, Belfast BT5 7DL",
    capitalValue: "£165,000",
  },
  {
    propertyId: "107182",
    fullAddress: "110 Gilnahirk Road, Tullycarnet, Belfast BT5 7DL",
    capitalValue: "£250,000",
  },
]);

const DETAIL_HTML = `
<table>
  <tr><th scope="row" class="govuk-table__header">
    Description
    <p class="govuk-body-s table-hint">For example, outbuildings include garages, stores or garden rooms.</p>
  </th><td class="govuk-table__cell">house outbuilding garden</td></tr>
  <tr><th scope="row" class="govuk-table__header">
    Capital Value (non‑exempt)
    <p class="govuk-body-s table-hint">Used to calculate domestic rates.</p>
  </th><td class="govuk-table__cell">&#xA3;250,000.00</td></tr>
  <tr><th scope="row" class="govuk-table__header">
    Capital Value (exempt)
    <p class="govuk-body-s table-hint">Value exempt from rates.</p>
  </th><td class="govuk-table__cell">&#xA3;0.00</td></tr>
  <tr><th class="govuk-table__header">Property size</th><td class="govuk-table__cell">186m&#xB2;</td></tr>
  <tr><th class="govuk-table__header">Garage</th><td class="govuk-table__cell">Yes</td></tr>
</table>`;

function fakeFetch() {
  return vi.fn((url: unknown) => {
    const u = String(url);
    const body = u.includes("GetResultsByPostcode")
      ? SEARCH_JSON
      : u.includes("Details")
        ? DETAIL_HTML
        : "";
    return Promise.resolve(new Response(body, { status: 200 }));
  });
}

describe("parseCapitalValue", () => {
  it("parses pound amounts and rejects N/A", () => {
    expect(parseCapitalValue("£165,000")).toBe(165000);
    expect(parseCapitalValue("£250,000.00")).toBe(250000);
    expect(parseCapitalValue("N/A")).toBeNull();
    expect(parseCapitalValue("")).toBeNull();
  });
});

describe("parseSearchResults", () => {
  it("maps rows and marks non-domestic (N/A) capital values null", () => {
    const rows = parseSearchResults(SEARCH_JSON);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.capitalValue).toBeNull();
    expect(rows[1]).toMatchObject({ propertyId: "107183", capitalValue: 165000 });
  });
});

describe("parseDetailHtml", () => {
  it("extracts size, garage, garden and the non-exempt capital value", () => {
    const d = parseDetailHtml(DETAIL_HTML);
    expect(d.sizeSqm).toBe(186);
    expect(d.hasGarage).toBe(true);
    expect(d.hasGarden).toBe(true);
    expect(d.capitalValue).toBe(250000);
  });

  it("handles a no-garage flat without garden", () => {
    const html = DETAIL_HTML.replace("house outbuilding garden", "flat")
      .replace(">Yes<", ">No<")
      .replace("186m&#xB2;", "62m&#xB2;");
    const d = parseDetailHtml(html);
    expect(d).toMatchObject({ sizeSqm: 62, hasGarage: false, hasGarden: false });
  });
});

describe("matchAddress", () => {
  const rows = parseSearchResults(SEARCH_JSON);

  it("matches a listing address to the right LPS row by numbered prefix", () => {
    expect(matchAddress(rows, "110 Gilnahirk Road, Belfast")?.propertyId).toBe(
      "107182",
    );
  });

  it("does not let 110 match 112 or the prefix-sharing school at 120", () => {
    expect(matchAddress(rows, "11 Gilnahirk Road")).toBeNull();
  });

  it("skips non-numbered segments (agent prose) and returns null when unknown", () => {
    expect(matchAddress(rows, "Charming home, Gilnahirk Road")).toBeNull();
  });

  it("rejects same-name streets elsewhere via the asking/CV plausibility band", () => {
    // four "1 Thornhill Crescent"s exist in NI; the £400k listing cannot be
    // the £77.5k-CV Dunmurry one (5.2×) — it's the Belfast one at ~2.2×
    const thornhill = [
      {
        propertyId: "a",
        fullAddress: "1 Thornhill Crescent, Dunmurry, Belfast BT17 0RH",
        capitalValue: 77500,
      },
      {
        propertyId: "b",
        fullAddress: "1 Thornhill Crescent, Ballycloghan, Belfast BT5 7AS",
        capitalValue: 180000,
      },
    ];
    const hit = matchAddress(thornhill, "1 Thornhill Crescent, Belfast", {
      postcode: "BT17 0BT",
      askingPrice: 400000,
    });
    expect(hit?.propertyId).toBe("b");
    // without a price the district match would (wrongly but defensibly) win
    expect(
      matchAddress(thornhill, "1 Thornhill Crescent, Belfast", {
        postcode: "BT17 0BT",
      })?.propertyId,
    ).toBe("a");
  });
});

describe("lookupLpsProperty", () => {
  it("searches, fetches detail, caches, and serves repeats from cache", async () => {
    const db = createDb(":memory:");
    const fetchImpl = fakeFetch();
    const first = await lookupLpsProperty(
      db,
      { postcode: "bt57dl", address: "110 Gilnahirk Road, Belfast" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(first).toMatchObject({
      propertyId: "107182",
      postcode: "BT5 7DL",
      sizeSqm: 186,
      hasGarage: 1,
      hasGarden: 1,
      capitalValue: 250000,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // search + detail

    const again = await lookupLpsProperty(
      db,
      { postcode: "BT5 7DL", address: "110 Gilnahirk Road" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(again?.propertyId).toBe("107182");
    expect(fetchImpl).toHaveBeenCalledTimes(2); // cache hit, no new requests
    expect(db.select().from(lpsProperties).all()).toHaveLength(1);
  });

  it("falls back to street search and corrects a wrong geocoded postcode", async () => {
    const db = createDb(":memory:");
    const street = JSON.stringify([
      {
        propertyId: "107243",
        fullAddress: "17 Gilnahirk Walk, Tullycarnet, Belfast BT5 7DS",
        capitalValue: "£180,000.00",
      },
    ]);
    const fetchImpl = vi.fn((url: unknown, init?: { body?: unknown }) => {
      const u = String(url);
      const body = u.includes("GetResultsByAdvanced")
        ? street
        : u.includes("GetResultsByPostcode")
          ? SEARCH_JSON // BT5 7DL has no Gilnahirk Walk
          : DETAIL_HTML;
      void init;
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    const out = await lookupLpsProperty(
      db,
      { postcode: "BT5 7DL", address: "17 Gilnahirk Walk, Belfast" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(out?.propertyId).toBe("107243");
    expect(out?.postcode).toBe("BT5 7DS"); // true postcode from the LPS address

    const e = await lpsEnrichment(
      db,
      { postcode: "BT5 7DL", address: "17 Gilnahirk Walk, Belfast" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(e.postcode).toBe("BT5 7DS");
    expect(e.sizeSqm).toBe(186);
  });

  it("returns null when the address is not in the postcode or street search", async () => {
    const db = createDb(":memory:");
    const out = await lookupLpsProperty(
      db,
      { postcode: "BT5 7DL", address: "999 Nowhere Lane" },
      { fetchImpl: fakeFetch() as unknown as typeof fetch },
    );
    expect(out).toBeNull();
  });
});

describe("lpsEnrichment", () => {
  it("fills size/garage/garden from LPS and tags the size source", async () => {
    const db = createDb(":memory:");
    const e = await lpsEnrichment(
      db,
      { postcode: "BT5 7DL", address: "110 Gilnahirk Road, Belfast" },
      { fetchImpl: fakeFetch() as unknown as typeof fetch },
    );
    expect(e).toMatchObject({
      sizeSqm: 186,
      hasGarage: true,
      hasGarden: true,
      lpsPropertyId: "107182",
      lpsCapitalValue: 250000,
      sizeSource: "lps",
    });
  });

  it("never overrides listing-published size or features", async () => {
    const db = createDb(":memory:");
    const e = await lpsEnrichment(
      db,
      {
        postcode: "BT5 7DL",
        address: "110 Gilnahirk Road, Belfast",
        sizeSqm: 120,
        hasGarage: false,
      },
      { fetchImpl: fakeFetch() as unknown as typeof fetch },
    );
    expect(e.sizeSqm).toBe(120);
    expect(e.sizeSource).toBe("listing");
    expect(e.hasGarage).toBe(false);
    expect(e.hasGarden).toBe(true);
  });

  it("resolves a listing with NO postcode via street search (and supplies one)", async () => {
    const db = createDb(":memory:");
    const street = JSON.stringify([
      {
        propertyId: "555",
        fullAddress: "103 Wynchurch Road, Rosetta, Belfast BT6 0HW",
        capitalValue: "£140,000",
      },
    ]);
    const fetchImpl = vi.fn((url: unknown) => {
      const u = String(url);
      const body = u.includes("GetResultsByAdvanced")
        ? street
        : u.includes("Details")
          ? DETAIL_HTML
          : "[]";
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    const e = await lpsEnrichment(
      db,
      { address: "103 Wynchurch Road, Rosetta, Belfast", askingPrice: 185000 },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(e.postcode).toBe("BT6 0HW");
    expect(e.sizeSqm).toBe(186);
    expect(e.lpsPropertyId).toBe("555");
  });

  it("degrades gracefully when the service errors", async () => {
    const db = createDb(":memory:");
    const failing = vi.fn(() =>
      Promise.resolve(new Response("", { status: 404 })),
    );
    const e = await lpsEnrichment(
      db,
      { postcode: "BT5 7DL", address: "110 Gilnahirk Road" },
      { fetchImpl: failing as unknown as typeof fetch },
    );
    expect(e).toEqual({});
  });
});
