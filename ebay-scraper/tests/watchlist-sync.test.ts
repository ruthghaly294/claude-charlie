import { describe, expect, it } from "vitest";
import { WatchStore, runWatchCycle } from "../src/watcher.js";
import { watchlistRowSchema } from "../src/supabase-watchlist.js";
import { syncWatchlist, publishResearch } from "../src/watchlist-sync.js";
import { listingSchema } from "../src/contract.js";
const entry = watchlistRowSchema.parse({
  id: "d76774de-6fea-4d07-8adf-227d57e03da6",
  telegram_chat_id: "123",
  name: "Radiology book",
  query: "OBrien second edition",
  revision: 1,
  research_requested_at: "2026-10-27T18:00:00Z",
  created_at: "2026-10-27T18:00:00Z",
  updated_at: "2026-10-27T18:00:00Z",
});
const now = Date.UTC(2026, 9, 27, 18);
describe("Supabase to scheduler synchronization", () => {
  it("researches once, publishes sampled floor and ceiling, then enables ongoing searches only after opt-in", async () => {
    const store = new WatchStore(":memory:");
    try {
      syncWatchlist(store, [entry]);
      expect(store.list()).toHaveLength(1);
      expect(store.list()[0]).toMatchObject({
        mode: "sold",
        once: true,
        notifyNew: false,
      });
      await runWatchCycle(
        store,
        async () => [
          listingSchema.parse({
            item_id: "123",
            position: 1,
            title: "OBrien second edition",
            url: "https://www.ebay.co.uk/itm/123",
            is_sold: true,
            ended_date: "27 Oct 2026",
            sale_price: { value: 25, currency: "GBP", symbol: "£", raw: "£25" },
          }),
        ],
        async () => {},
        () => now,
      );
      publishResearch(store, [entry], now);
      const report = store.pending(now)[0];
      expect(report?.payload).toContain("floor £25.00 · ceiling £25.00");
      expect(
        report?.media?.buttons?.flat().some((b) => b.data.endsWith(":yes")),
      ).toBe(true);
      syncWatchlist(store, [entry]);
      publishResearch(store, [entry], now);
      expect(store.pending(now)).toHaveLength(1);
      let calls = 0;
      await runWatchCycle(
        store,
        async () => {
          calls++;
          return [];
        },
        async () => {},
        () => now + 120000,
      );
      expect(calls).toBe(0);
      syncWatchlist(store, [
        { ...entry, monitor_active: true, monitor_sold: true, revision: 2 },
      ]);
      expect(
        store
          .list()
          .map((w) => w.mode)
          .sort(),
      ).toEqual(["active", "sold"]);
    } finally {
      store.close();
    }
  });
  it("stops deleted jobs and queued alerts, including jobs captured before deletion", async () => {
    const store = new WatchStore(":memory:");
    try {
      syncWatchlist(store, [{ ...entry, monitor_active: true }]);
      const old = store.list()[0]!;
      store.enqueue(old.id, "pending", "stale listing");
      syncWatchlist(store, []);
      store.record(old.id, [], now);
      expect(store.list()).toHaveLength(0);
      expect(store.pending(now)).toHaveLength(0);
    } finally {
      store.close();
    }
  });
  it("replaces edited search definitions and forwards condition, price and delivery filters", () => {
    const store = new WatchStore(":memory:");
    try {
      syncWatchlist(store, [entry]);
      const old = store.list()[0]!.id;
      syncWatchlist(store, [
        {
          ...entry,
          query: "Third edition",
          condition: "used",
          max_price: 30,
          free_shipping: true,
          revision: 2,
        },
      ]);
      expect(store.get(old)).toBeUndefined();
      expect(store.list()[0]).toMatchObject({
        query: "Third edition",
        condition: "used",
        maxPrice: 30,
        freeShipping: true,
      });
    } finally {
      store.close();
    }
  });
});

it("adopts existing watches without resetting their baseline", () => {
  const store = new WatchStore(":memory:");
  try {
    const original = store.create({
      name: entry.name + " — sold",
      query: entry.query,
      domain: "co.uk",
      mode: "sold",
    });
    store.record(original.id, [], now);
    store.link(original.id, entry.id, entry.research_requested_at!);
    syncWatchlist(store, [{ ...entry, monitor_sold: true }]);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.id).toBe(original.id);
    expect(store.list()[0]?.baselined).toBe(true);
  } finally {
    store.close();
  }
});

it("keeps queued research and baseline when ongoing monitoring is enabled", async () => {
  const store = new WatchStore(":memory:");
  try {
    syncWatchlist(store, [entry]);
    const job = store.list()[0]!;
    store.record(job.id, [], now);
    publishResearch(store, [entry], now);
    syncWatchlist(store, [
      { ...entry, monitor_sold: true, monitor_active: true, revision: 2 },
    ]);
    expect(store.get(job.id)?.baselined).toBe(true);
    expect(store.get(job.id)?.once).toBe(false);
    expect(store.pending(now)).toHaveLength(1);
  } finally {
    store.close();
  }
});
it("passes the watch list's must-mention and block words to the live search", () => {
  const store = new WatchStore(":memory:");
  syncWatchlist(store, [
    watchlistRowSchema.parse({
      ...entry,
      monitor_active: true,
      include_words: "chesterfield, captain’s ,",
      exclude_words: "PU",
    }),
  ]);
  expect(store.list().find((w) => w.mode === "active")).toMatchObject({
    includeWords: ["chesterfield", "captain’s"],
    excludeWords: ["PU"],
  });
  store.close();
});
