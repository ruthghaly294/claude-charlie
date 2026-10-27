import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WatchStore, runWatchCycle, watchSchema } from "../src/watcher.js";
import { listingSchema, type Listing } from "../src/contract.js";
const item = (id: string, sold = false): Listing =>
  listingSchema.parse({
    item_id: id,
    position: 1,
    title: "Chair",
    url: `https://www.ebay.co.uk/itm/${id}`,
    is_sold: sold,
    price: { value: 200, currency: "GBP", symbol: "£", raw: "£200" },
  });
const watch = {
  name: "Chairs",
  query: "chesterfield captain chairs",
  domain: "co.uk",
  mode: "active",
  intervalMinutes: 10,
};
describe("durable scheduled searches", () => {
  it("baselines without alerts, queues only new items, and survives reopening", async () => {
    const dir = await mkdtemp(join(tmpdir(), "watch-test-"));
    const file = join(dir, "state.sqlite");
    try {
      let store = new WatchStore(file);
      const job = store.create(watch);
      store.record(job.id, [item("123")], 1000);
      expect(store.pending(1000)).toHaveLength(0);
      store.close();
      store = new WatchStore(file);
      store.record(job.id, [item("123"), item("456")], 2000);
      expect(store.pending(2000)).toHaveLength(1);
      store.record(job.id, [item("456")], 3000);
      expect(store.pending(3000)).toHaveLength(1);
      store.delivered(store.pending(3000)[0]!.id);
      expect(store.pending(3000)).toHaveLength(0);
      store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("sold watches exclude unknown outcomes and retry failed delivery without losing alerts", async () => {
    const store = new WatchStore(":memory:");
    const job = store.create({ ...watch, mode: "sold" });
    store.record(job.id, [item("123", true)], 1000);
    store.record(job.id, [item("456"), item("789", true)], 2000);
    expect(store.pending(2000)).toHaveLength(1);
    let attempts = 0;
    const run = () =>
      runWatchCycle(
        store,
        async () => {
          throw new Error("not due");
        },
        async () => {
          attempts++;
          throw new Error("secret must not leak");
        },
        () => 2000,
      );
    await run();
    expect(attempts).toBe(1);
    expect(store.pending(2000)).toHaveLength(0);
    expect(store.pending(4000000)).toHaveLength(1);
    expect(store.list()[0]!.lastError).toBeNull();
    store.close();
  });
  it("failed scans do not establish a baseline or erase state", async () => {
    const store = new WatchStore(":memory:");
    store.create(watch);
    await runWatchCycle(
      store,
      async () => {
        throw new Error("failed");
      },
      async () => {},
      () => 1000,
    );
    expect(store.list()[0]!.baselined).toBe(false);
    expect(store.list()[0]!.lastError).toBe("SEARCH_FAILED");
    store.close();
  });
  it("bounds frequency, mode, marketplace and query size", () => {
    expect(
      watchSchema.safeParse({ ...watch, intervalMinutes: 0 }).success,
    ).toBe(false);
    expect(watchSchema.safeParse({ ...watch, mode: "arbitrary" }).success).toBe(
      false,
    );
    expect(
      watchSchema.safeParse({ ...watch, domain: "evil.test" }).success,
    ).toBe(false);
  });
});

describe("market-aware alerts", () => {
  it("persists disclosed comparable sales and adds deal context to a new active listing", () => {
    const store = new WatchStore(":memory:");
    const now = Date.UTC(2026, 9, 27);
    const sold = store.create({
      name: "Cards sold",
      query: "charizard",
      mode: "sold",
      marketProfile: "charizard_psa9_base",
    });
    const rows = Array.from({ length: 5 }, (_, i) => ({
      ...item(String(100 + i), true),
      title: "1999 Charizard Base Set 4/102 PSA 9",
      ended_date: "26 Oct 2026",
      best_offer_accepted: false,
      sale_price: {
        value: 200 + i * 10,
        currency: "GBP",
        symbol: "£",
        raw: "£200",
      },
    }));
    store.record(sold.id, rows, now);
    expect(store.market("charizard_psa9_base", 90, now).median).toBe(220);
    const active = store.create({
      name: "Cards active",
      query: "charizard",
      mode: "active",
      marketProfile: "charizard_psa9_base",
    });
    store.record(active.id, [], now);
    store.record(
      active.id,
      [
        {
          ...item("999"),
          title: "1999 Charizard Base Set 4/102 PSA 9",
          price: { value: 100, currency: "GBP", symbol: "£", raw: "£100" },
          free_shipping: true,
          is_auction: false,
        },
      ],
      now,
    );
    expect(store.pending(now)[0]?.payload).toContain("POTENTIAL BELOW-MARKET");
    store.close();
  });
});
