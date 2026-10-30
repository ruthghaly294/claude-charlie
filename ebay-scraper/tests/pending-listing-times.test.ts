import { expect, it } from "vitest";
import { createPendingListingTimeWorker } from "../src/pending-listing-times.js";
import { createEbayListingTimeQueue } from "../src/ebay-listing-time-queue.js";
import { listingSchema } from "../src/contract.js";
import { WatchStore } from "../src/watcher.js";
it("recovers an alert's timestamp while its search is still failing and in backoff", async () => {
  const store = new WatchStore(":memory:");
  let now = Date.parse("2026-10-30T10:00:00Z");
  let recovered = false;
  try {
    const job = store.create({
      name: "chairs",
      query: "chairs",
      mode: "active",
    });
    store.record(job.id, [], now - 120000);
    const resolve = createEbayListingTimeQueue({
      store,
      clock: () => now,
      seen: (id, item) => store.hasSeen(id, item),
      fetchHtml: async () => {
        if (!recovered) throw Error("temporary");
        return '<script>{"itemId":"267605857214","startTime":"2026-03-14T11:04:38.000Z"}</script>';
      },
    });
    const row = listingSchema.parse({
      position: 1,
      item_id: "267605857214",
      title: "Chair",
      url: "https://www.ebay.co.uk/itm/267605857214",
    });
    expect(await resolve(store.get(job.id)!, [row])).toEqual([]);
    store.failure(job.id, "UPSTREAM_ACCESS_DENIED", now);
    const failed = store.get(job.id)!;
    now += 60001;
    recovered = true;
    const worker = createPendingListingTimeWorker({
      store,
      resolve,
      clock: () => now,
    });
    await worker();
    expect(store.listings(job.id)[0]?.listed_at).toBe(
      "2026-03-14T11:04:38.000Z",
    );
    expect(store.get(job.id)).toMatchObject({
      lastSuccess: failed.lastSuccess,
      lastError: failed.lastError,
      nextRun: failed.nextRun,
    });
    expect(store.pending(now)).toHaveLength(1);
    expect(store.pending(now)[0]?.payload).toContain("14 Mar 2026");
  } finally {
    store.close();
  }
});
it("does not hammer pending details on each scheduler tick after a failure", async () => {
  const store = new WatchStore(":memory:");
  let now = 0,
    calls = 0;
  try {
    const job = store.create({
      name: "chairs",
      query: "chairs",
      mode: "active",
    });
    store.record(job.id, [], 0);
    const resolve = Object.assign(
      async () => {
        calls++;
        throw Error("unavailable");
      },
      { hasPending: () => true },
    );
    const worker = createPendingListingTimeWorker({
      store,
      resolve,
      clock: () => now,
    });
    await worker();
    now = 15000;
    await worker();
    expect(calls).toBe(1);
    now = 60000;
    await worker();
    expect(calls).toBe(2);
  } finally {
    store.close();
  }
});
