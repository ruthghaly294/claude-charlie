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

it("enriches unseen active alerts from the item detail page and preserves alerts on a detail failure", async () => {
  const app = buildApp({ fetchHtml: async () => html });
  const store = new WatchStore(":memory:");
  try {
    const created = store.create({
      name: "chairs",
      query: "chairs",
      mode: "active",
    });
    store.record(created.id, [], Date.parse("2026-10-28T11:00:00Z"));
    const job = store.get(created.id)!;
    const fetched: string[] = [];
    const rows = await createWatchSearch(app, undefined, () => false, {
      seen: () => false,
      fetchHtml: async (_query, _signal, id) => {
        fetched.push(id!);
        if (fetched.length === 2) throw new Error("blocked");
        return `<script>{"itemId":"${id}","startTime":"2026-10-28T11:48:00Z"}</script>`;
      },
    })(job);
    expect(fetched).toHaveLength(2);
    expect(rows[0]?.listed_at).toBe("2026-10-28T11:48:00.000Z");
    expect(rows[1]?.listed_at).toBeNull();
    store.record(job.id, rows, Date.parse("2026-10-28T12:00:00Z"));
    expect(store.pending(Date.now())[0]?.payload).toContain("12 minutes ago");
  } finally {
    store.close();
    await app.close();
  }
});

it("looks up the listing time for every new result eBay's search returns, not just market comparables", async () => {
  const { load } = await import("cheerio");
  const $ = load(html);
  $(".s-item__title,.s-card__title")
    .first()
    .text("English unlimited Charizard 4/102 PSA 9");
  const app = buildApp({ fetchHtml: async () => $.html() });
  const store = new WatchStore(":memory:");
  try {
    const saved = store.create({
      name: "Pokemon",
      query: "charizard",
      mode: "active",
      marketProfile: "charizard_psa9_base",
    });
    store.record(saved.id, [], 1000);
    const fetched: string[] = [];
    await createWatchSearch(app, undefined, () => false, {
      seen: () => false,
      fetchHtml: async (_q, _s, id) => {
        fetched.push(id!);
        return "<h1>Detail</h1>";
      },
    })(store.get(saved.id)!);
    expect(fetched.length).toBeGreaterThan(1);
  } finally {
    store.close();
    await app.close();
  }
});

it("holds a failed timestamp lookup and later alerts with the verified start and original detection time", async () => {
  const { createEbayListingTimeQueue } =
    await import("../src/ebay-listing-time-queue.js");
  const app = buildApp({ fetchHtml: async () => html });
  const store = new WatchStore(":memory:");
  let now = Date.parse("2026-10-30T09:01:00Z");
  let recovered = false;
  try {
    const created = store.create({
      name: "chairs",
      query: "chairs",
      mode: "active",
    });
    store.record(created.id, [], now - 60000);
    const details = async (_q: unknown, _s: unknown, id?: string) => {
      if (!recovered) throw Error("temporary");
      return `<script>{"listingId":"${id}","startDate":{"value":"2026-10-30T09:00:00.000Z"}}</script>`;
    };
    const seen = (job: string, item: string) => store.hasSeen(job, item);
    const search = createWatchSearch(app, undefined, () => false, {
      fetchHtml: details,
      seen,
      resolveTimes: createEbayListingTimeQueue({
        store,
        fetchHtml: details,
        seen,
        clock: () => now,
      }),
    });
    const first = await search(store.get(created.id)!);
    store.record(created.id, first, now);
    expect(store.pending(now)).toEqual([]);
    now += 120000;
    recovered = true;
    const second = await search(store.get(created.id)!);
    store.record(created.id, second, now);
    expect(store.pending(now)).toHaveLength(2);
    expect(store.pending(now)[0]?.payload).toContain(
      "3 minutes ago (at alert)",
    );
    expect(store.pending(now)[0]?.payload).toContain(
      "Detected 2026-10-30T09:01:00.000Z",
    );
  } finally {
    store.close();
    await app.close();
  }
});

it("continues active discovery onto later pages until it reaches known results", async () => {
  const { default: Fastify } = await import("fastify");
  const { listingSchema } = await import("../src/contract.js");
  const app = Fastify();
  const pages: number[] = [];
  app.get("/v1/ebay/search", async (request) => {
    const page = Number((request.query as { page: string }).page);
    pages.push(page);
    return {
      query: "chairs",
      domain: "co.uk",
      category_id: null,
      sold: false,
      results: [
        listingSchema.parse({
          position: 1,
          item_id: String(page),
          title: "Chair",
          url: `https://www.ebay.co.uk/itm/${page}`,
        }),
      ],
      facets: {},
      pagination: {
        current_page: page,
        per_page: 60,
        returned: 1,
        total_results: null,
        total_pages: null,
        has_more: true,
      },
      scraped_utc: 0,
      scraped_at: "2026-10-30T12:00:00Z",
    };
  });
  const s = new WatchStore(":memory:");
  try {
    const j = s.create({ name: "chairs", query: "chairs", mode: "active" });
    s.record(j.id, [], 0);
    const rows = await createWatchSearch(app, undefined, () => false, {
      fetchHtml: async () => "",
      seen: (_job, id) => id === "2",
      paginateActive: true,
    })(s.get(j.id)!);
    expect(pages).toEqual([1, 2]);
    expect(rows.map((r) => r.item_id)).toEqual(["1", "2"]);
  } finally {
    s.close();
    await app.close();
  }
});
