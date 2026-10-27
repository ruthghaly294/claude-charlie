import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";
import { WatchStore } from "../src/watcher.js";
import { createWatchSearch } from "../src/watch-search.js";
const html = readFileSync(
  new URL("./fixtures/search.html", import.meta.url),
  "utf8",
);
describe("watch search filters", () => {
  it("forwards saved condition, price and delivery preferences through the real API contract", async () => {
    const queries: unknown[] = [];
    const app = buildApp({
      fetchHtml: async (query) => {
        queries.push(query);
        return html;
      },
    });
    const store = new WatchStore(":memory:");
    try {
      const job = store.create({
        name: "Book",
        query: "OBrien second edition",
        mode: "active",
        domain: "co.uk",
        condition: "used",
        minPrice: 10,
        maxPrice: 40,
        freeShipping: true,
        location: "domestic",
        buyingFormat: "buy_it_now",
        language: "english",
      });
      const rows = await createWatchSearch(app)(job);
      expect(rows).toHaveLength(2);
      expect(queries[0]).toMatchObject({
        query: "OBrien second edition",
        sort_by: "newly_listed",
        condition: "used",
        min_price: 10,
        max_price: 40,
        free_shipping: true,
        location: "domestic",
        buying_format: "buy_it_now",
        language: "english",
      });
    } finally {
      store.close();
      await app.close();
    }
  });
});
