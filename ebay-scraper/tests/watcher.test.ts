import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WatchStore,
  deliverWatchAlerts,
  runWatchCycle,
  watchSchema,
} from "../src/watcher.js";
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

describe("quiet failure recovery", () => {
  it("keeps transient failures silent even when errors alternate and scans recover", () => {
    const store = new WatchStore(":memory:");
    const job = store.create(watch);
    for (let i = 0; i < 100; i++) {
      const now = i * 120000;
      store.failure(
        job.id,
        i % 2 ? "UPSTREAM_TIMEOUT" : "UPSTREAM_BROWSER_ERROR",
        now,
      );
      store.record(job.id, [], now + 1000);
    }
    expect(store.pending(86400000)).toHaveLength(0);
    store.close();
  });
  it("shares a durable daily health alert cap across searches and error codes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "watch-health-"));
    const file = join(dir, "state.sqlite");
    let store = new WatchStore(file);
    try {
      const a = store.create(watch);
      const b = store.create(watch);
      store.failure(a.id, "UPSTREAM_TIMEOUT", 0);
      expect(store.pending(0)).toHaveLength(0);
      store.failure(a.id, "UPSTREAM_TIMEOUT", 1800000);
      expect(store.pending(1800000)).toHaveLength(1);
      store.delivered(store.pending(1800000)[0]!.id, 1800000);
      store.close();
      store = new WatchStore(file);
      store.failure(b.id, "UPSTREAM_AUTH_REQUIRED", 1800001);
      store.record(a.id, [], 1800002);
      store.failure(a.id, "UPSTREAM_AUTH_REQUIRED", 1800003);
      expect(store.pending(1800003)).toHaveLength(0);
      store.failure(b.id, "UPSTREAM_AUTH_REQUIRED", 88200000);
      expect(store.pending(88200000)).toHaveLength(1);
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("backs off failed scans durably and resets after success without losing listing alerts", () => {
    const store = new WatchStore(":memory:");
    const job = store.create({ ...watch, intervalMinutes: 2 });
    store.record(job.id, [item("1")], 0);
    store.failure(job.id, "UPSTREAM_TIMEOUT", 1000);
    expect(store.get(job.id)?.nextRun).toBe(121000);
    store.failure(job.id, "UPSTREAM_TIMEOUT", 121000);
    expect(store.get(job.id)?.nextRun).toBe(361000);
    store.record(job.id, [item("2")], 400000);
    expect(store.pending(400000)).toHaveLength(1);
    store.failure(job.id, "UPSTREAM_TIMEOUT", 520000);
    expect(store.get(job.id)?.nextRun).toBe(640000);
    expect(store.get(job.id)?.lastSuccess).toBe(400000);
    store.close();
  });
  it("withdraws unsent health warnings after the affected search recovers", () => {
    const store = new WatchStore(":memory:");
    const job = store.create(watch);
    store.failure(job.id, "UPSTREAM_AUTH_REQUIRED", 0);
    expect(store.pending(0)).toHaveLength(1);
    store.record(job.id, [], 1000);
    expect(store.pending(1000)).toHaveLength(0);
    store.close();
  });
});

it("withdraws legacy queued errors on upgrade while retaining listing messages and the daily cap", async () => {
  const dir = await mkdtemp(join(tmpdir(), "watch-upgrade-"));
  const file = join(dir, "state.sqlite");
  try {
    const before = new WatchStore(file);
    const job = before.create(watch);
    before.enqueue(job.id, "error:UPSTREAM_TIMEOUT:1000", "old warning");
    before.enqueue(job.id, "listing:1", "new listing");
    before.close();
    const after = new WatchStore(file);
    expect(after.pending(2000).map((p) => p.payload)).toEqual(["new listing"]);
    after.failure(job.id, "UPSTREAM_AUTH_REQUIRED", 2000);
    expect(after.pending(2000)).toHaveLength(1);
    after.close();
    const db = new DatabaseSync(file);
    expect(
      db
        .prepare("SELECT count(*) AS n FROM outbox WHERE item LIKE 'error:%'")
        .get()?.["n"],
    ).toBe(0);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("retains listing photos and links in the durable outbox until delivered", async () => {
  const dir = await mkdtemp(join(tmpdir(), "watch-photo-"));
  const file = join(dir, "state.sqlite");
  let store = new WatchStore(file);
  try {
    const job = store.create(watch);
    store.record(job.id, [], 0);
    const listing = {
      ...item("123"),
      image: "https://i.ebayimg.com/images/g/example/s-l500.jpg",
    };
    store.record(job.id, [listing], 1000);
    store.close();
    store = new WatchStore(file);
    let received: unknown;
    await runWatchCycle(
      store,
      async () => [],
      async (_text, media) => {
        received = media;
      },
      () => 1000,
    );
    expect(received).toMatchObject({ image: listing.image, url: listing.url });
    expect(store.pending(1000)).toHaveLength(0);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("does not accumulate health warnings during a multi-day Telegram outage", async () => {
  const store = new WatchStore(":memory:");
  try {
    const a = store.create(watch);
    const b = store.create(watch);
    store.failure(a.id, "UPSTREAM_AUTH_REQUIRED", 0);
    store.failure(b.id, "UPSTREAM_AUTH_REQUIRED", 86400001);
    expect(store.pending(86400001)).toHaveLength(1);
    const pending = store.pending(86400001)[0]!;
    store.delivered(pending.id, 86400001);
    store.failure(b.id, "UPSTREAM_AUTH_REQUIRED", 86400002);
    expect(store.pending(86400002)).toHaveLength(0);
  } finally {
    store.close();
  }
});

it("labels discovery after an outage without claiming the seller listed it at detection time", () => {
  const store = new WatchStore(":memory:");
  try {
    const job = store.create({ ...watch, intervalMinutes: 2 });
    store.record(job.id, [], 0);
    store.record(job.id, [item("123")], 3600000);
    expect(store.pending(3600000)[0]?.payload).toContain(
      "Newly detected listing",
    );
    expect(store.pending(3600000)[0]?.payload).toContain("monitoring gap");
  } finally {
    store.close();
  }
});

it("honors a pause made while an earlier search in the same cycle is running", async () => {
  const store = new WatchStore(":memory:");
  try {
    const first = store.create(watch);
    const second = store.create(watch);
    store.record(second.id, [], 0);
    const calls: string[] = [];
    await runWatchCycle(
      store,
      async (job) => {
        calls.push(job.id);
        if (job.id === first.id)
          store.configure(second.id, {
            ...watch,
            domain: "co.uk",
            mode: "active",
            once: true,
          });
        return [];
      },
      async () => {},
      () => 1000000,
    );
    expect(calls).toEqual([first.id]);
  } finally {
    store.close();
  }
});

it("keeps temporary eBay error retries within five minutes while respecting the polling interval", () => {
  const store = new WatchStore(":memory:");
  try {
    const fast = store.create({ ...watch, intervalMinutes: 2 });
    for (let attempt = 0; attempt < 8; attempt++)
      store.failure(fast.id, "UPSTREAM_TEMPORARY_ERROR", 1000000);
    expect(store.get(fast.id)?.nextRun).toBe(1000000 + 5 * 60000);
    const slow = store.create({ ...watch, intervalMinutes: 10 });
    for (let attempt = 0; attempt < 8; attempt++)
      store.failure(slow.id, "UPSTREAM_TEMPORARY_ERROR", 1000000);
    expect(store.get(slow.id)?.nextRun).toBe(1000000 + 10 * 60000);
  } finally {
    store.close();
  }
});
it("sends each alert once when several search lanes deliver at the same time", async () => {
  const store = new WatchStore(":memory:");
  const job = store.create(watch);
  store.record(job.id, [item("123")], 1000);
  store.record(job.id, [item("123"), item("456")], 2000);
  expect(store.pending(2000)).toHaveLength(1);
  let sends = 0;
  const send = async () => {
    sends++;
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  await Promise.all([
    deliverWatchAlerts(
      store,
      send,
      () => 2000,
      () => false,
    ),
    deliverWatchAlerts(
      store,
      send,
      () => 2000,
      () => false,
    ),
  ]);
  expect(sends).toBe(1);
  store.close();
});
it("alerts on any new active result eBay's search returns, keeping market checks for price claims only", () => {
  const store = new WatchStore(":memory:");
  const job = store.create({ ...watch, marketProfile: "chairs" });
  store.record(job.id, [item("1")], 1000);
  store.record(
    job.id,
    [
      item("1"),
      { ...item("2"), title: "Pair of Chesterfield captain chairs green" },
    ],
    2000,
  );
  const pending = store.pending(2000);
  expect(pending).toHaveLength(1);
  expect(pending[0]?.payload).toContain("Pair of Chesterfield captain chairs");
  expect(pending[0]?.payload).not.toContain("BELOW-MARKET");
  store.close();
});
it("applies the search's must-mention and block words to title and description before alerting", () => {
  const store = new WatchStore(":memory:");
  const job = store.create({
    ...watch,
    includeWords: ["captain"],
    excludeWords: ["pu"],
  });
  store.record(job.id, [], 1000);
  store.record(
    job.id,
    [
      { ...item("1"), title: "PU chesterfield captain chair" },
      { ...item("2"), title: "Leather chair" },
      {
        ...item("3"),
        title: "Leather chair",
        description: "Lovely Captain’s style, green",
      },
    ],
    2000,
  );
  const pending = store.pending(2000);
  expect(pending).toHaveLength(1);
  expect(pending[0]?.payload).toContain("https://www.ebay.co.uk/itm/3");
  store.close();
});
it("puts good-find and not-for-me buttons on every new listing alert", () => {
  const store = new WatchStore(":memory:");
  const job = store.create(watch);
  store.record(job.id, [item("1")], 1000);
  store.record(job.id, [item("1"), item("2")], 2000);
  expect(store.pending(2000)[0]?.media?.buttons).toEqual([
    [
      { text: "👍 Good find", data: "f:u:2" },
      { text: "👎 Not for me", data: "f:d:2" },
    ],
  ]);
  store.close();
});
