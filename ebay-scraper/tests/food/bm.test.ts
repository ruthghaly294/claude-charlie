import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseBm, priceReport } from "../../src/food/prices.js";
const url = "https://www.bmstores.co.uk/products/pepsi-max-8-x-330ml-307565";
const html =
  '<h1>Pepsi Max 8 x 330ml</h1><div class="bm-product-price-card"><span>£</span><span>3.75</span><div>2 FOR £7</div></div><p>Subject to availability. Visit your nearest store.</p><h2>You may also like</h2><p>Pepsi Max 18 x 330ml £6.99</p>';
it("compares B&M pack prices including multibuys without treating them as loyalty prices", () => {
  const rows = parseBm(html, url);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    shop: "B&M",
    count: 8,
    ml: 330,
    standard: 3.5,
    member: null,
    note: expect.stringContaining("2 for £7"),
  });
  expect(
    priceReport(rows, { failed: [], now: new Date("2026-10-28T12:00:00Z") }),
  ).toContain("B&amp;M");
});
it("does not use a related-product price or a blocked page", () => {
  expect(
    parseBm(
      "<h1>Pepsi Max 8 x 330ml</h1><h2>You may also like</h2><p>£1.29</p>",
      url,
    ),
  ).toEqual([]);
  expect(parseBm("<title>Access denied</title>", url)).toEqual([]);
});

it("uses the product price block, excluding breadcrumbs, navigation promotions and recommendations", () => {
  const page =
    '<nav>Pepsi Max 18 x 330ml <span>2 for £20</span></nav><h1>Pepsi Max 18 x 330ml</h1><div class="bm-product-price-card"><div><span>£</span><span>6.99</span></div><span>(£1.17/litre)</span></div><h2>You may also like</h2><span>£1.29</span>';
  expect(parseBm(page, url)[0]).toMatchObject({
    standard: 6.99,
    count: 18,
    ml: 330,
  });
});

it("parses the real B&M product-page capture", () => {
  const page = readFileSync(
    new URL("../fixtures/food/bm.html", import.meta.url),
    "utf8",
  );
  expect(
    parseBm(
      page,
      "https://www.bmstores.co.uk/products/pepsi-max-18-x-330ml-402775",
    )[0],
  ).toMatchObject({ standard: 6.99, count: 18, ml: 330 });
});
