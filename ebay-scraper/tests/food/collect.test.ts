import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { collectPrices, reportSlot } from "../../src/food/collect.js";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/food/${name}`, import.meta.url), "utf8");
const pages: Record<string, { html: string; responses: string[] }> = {
  "www.bmstores.co.uk": {
    html: "<h1>Pepsi Max 18 x 330ml</h1><div class='bm-product-price-card'><span>£6.99</span></div><p>Subject to availability</p>",
    responses: [],
  },
  "www.tesco.com": { html: fixture("tesco.html"), responses: [] },
  "www.asda.com": {
    html: "<title>ASDA</title>",
    responses: ['{"results":[]}', fixture("asda.json")],
  },
  "www.sainsburys.co.uk": {
    html: "",
    responses: [fixture("sainsburys.json")],
  },
  "www.lidl-ni.co.uk": { html: "", responses: [fixture("lidl.json")] },
  "www.spar-ni.co.uk": { html: fixture("spar.html"), responses: [] },
  "www.eurosparni.co.uk": { html: fixture("eurospar.html"), responses: [] },
};

it("searches every shop's own website and combines the Pepsi Max offers", async () => {
  const visited: string[] = [];
  const result = await collectPrices(async (url) => {
    visited.push(url);
    return pages[new URL(url).hostname]!;
  });
  expect(
    [...new Set(visited.map((url) => new URL(url).hostname))].sort(),
  ).toEqual(Object.keys(pages).sort());
  expect(result.failed).toEqual([]);
  expect(new Set(result.offers.map((o) => o.shop))).toEqual(
    new Set(["Tesco", "Asda", "Sainsbury's", "Lidl", "Spar", "B&M"]),
  );
});

it("reports a blocked or empty supermarket page as not checked, and carries on", async () => {
  const result = await collectPrices(async (url) => {
    const host = new URL(url).hostname;
    if (host === "www.tesco.com") throw new Error("timeout");
    if (host === "www.asda.com")
      return { html: "<title>Just a moment...</title>", responses: [] };
    return pages[host]!;
  });
  expect(result.failed).toEqual(["Tesco", "Asda"]);
  expect(result.offers.some((o) => o.shop === "Sainsbury's")).toBe(true);
});

it("runs on Monday and Thursday mornings from 8am UK time, once each", () => {
  expect(reportSlot(new Date("2026-10-26T08:00:00Z"))).toBe("2026-10-26");
  expect(reportSlot(new Date("2026-10-26T07:59:00Z"))).toBeUndefined();
  expect(reportSlot(new Date("2026-06-01T07:00:00Z"))).toBe("2026-06-01");
  expect(reportSlot(new Date("2026-10-29T12:00:00Z"))).toBe("2026-10-29");
  expect(reportSlot(new Date("2026-10-27T09:00:00Z"))).toBeUndefined();
  expect(reportSlot(new Date("2026-11-02T08:30:00Z"))).toBe("2026-11-02");
});
