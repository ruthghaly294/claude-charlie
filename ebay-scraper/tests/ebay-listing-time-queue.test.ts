import { expect, it } from "vitest";
import { listingSchema } from "../src/contract.js";
import { createEbayListingTimeQueue } from "../src/ebay-listing-time-queue.js";
import { watchSchema, type Watch } from "../src/watcher.js";
const row = listingSchema.parse({
  position: 1,
  item_id: "188151380608",
  title: "Chair",
  url: "https://www.ebay.co.uk/itm/188151380608",
});
const job: Watch = {
  ...watchSchema.parse({ name: "chairs", query: "chairs", mode: "active" }),
  id: "watch",
  baselined: true,
  nextRun: 0,
  lastSuccess: null,
  lastError: null,
  resultCount: 0,
};
const time = "2026-10-30T09:00:00.000Z";
function settings() {
  const values = new Map<string, string>();
  return {
    setting: (key: string) => values.get(key),
    setSetting: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
it("persists a failed lookup, retries after restart even if the listing leaves the search page, and retains first detection", async () => {
  const store = settings();
  let now = Date.parse("2026-10-30T09:01:00Z");
  const first = createEbayListingTimeQueue({
    store,
    clock: () => now,
    seen: () => false,
    fetchHtml: async () => {
      throw Error("temporary");
    },
  });
  expect(await first(job, [row])).toEqual([]);
  now += 120000;
  const restarted = createEbayListingTimeQueue({
    store,
    clock: () => now,
    seen: () => false,
    fetchHtml: async () =>
      `<script>{"listingId":"${row.item_id}","startDate":{"value":"${time}"}}</script>`,
  });
  const result = await restarted(job, []);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    listed_at: time,
    detected_at: "2026-10-30T09:01:00.000Z",
  });
});
it("reuses verified timestamps without fetching another detail page", async () => {
  const store = settings();
  let calls = 0;
  const options = {
    store,
    clock: () => Date.parse("2026-10-30T09:10:00Z"),
    seen: () => false,
    fetchHtml: async () => {
      calls++;
      return `<script>{"itemId":"${row.item_id}","startTime":"${time}"}</script>`;
    },
  };
  await createEbayListingTimeQueue(options)(job, [row]);
  expect(
    (await createEbayListingTimeQueue(options)(job, [row]))[0]?.listed_at,
  ).toBe(time);
  expect(calls).toBe(1);
});
it("releases an honest unavailable-time alert after the bounded waiting period", async () => {
  let now = Date.parse("2026-10-30T09:01:00Z");
  const lookup = createEbayListingTimeQueue({
    store: settings(),
    clock: () => now,
    seen: () => false,
    fetchHtml: async () => "<h1>Unavailable</h1>",
  });
  expect(await lookup(job, [row])).toEqual([]);
  now += 300000;
  const results = await lookup(job, []);
  expect(results).toHaveLength(1);
  expect(results[0]?.listed_at).toBeNull();
});
it("does not retry listings already alerted or pending rows from changed search filters", async () => {
  const store = settings();
  let calls = 0;
  const lookup = createEbayListingTimeQueue({
    store,
    clock: () => Date.parse("2026-10-30T09:01:00Z"),
    seen: () => false,
    fetchHtml: async () => {
      calls++;
      throw Error("temporary");
    },
  });
  await lookup(job, [row]);
  expect(await lookup({ ...job, query: "tables" }, [])).toEqual([]);
  const seen = createEbayListingTimeQueue({
    store,
    seen: () => true,
    fetchHtml: async () => {
      throw Error("must not fetch");
    },
  });
  expect(await seen(job, [row])).toEqual([row]);
  expect(calls).toBe(1);
});
it("bounds detail lookups per scan while retaining the unattempted rows", async () => {
  let calls = 0;
  const store = settings();
  const lookup = createEbayListingTimeQueue({
    store,
    clock: () => Date.parse("2026-10-30T09:01:00Z"),
    seen: () => false,
    fetchHtml: async () => {
      calls++;
      throw Error("temporary");
    },
  });
  expect(
    await lookup(
      job,
      Array.from({ length: 5 }, (_, i) => ({
        ...row,
        item_id: String(188151380608 + i),
      })),
    ),
  ).toEqual([]);
  expect(calls).toBe(3);
});

it("keeps resolved and unprocessed rows when cancellation interrupts a scan", async () => {
  const store = settings();
  let stop = false;
  const lookup = createEbayListingTimeQueue({
    store,
    clock: () => Date.parse("2026-10-30T09:10:00Z"),
    seen: () => false,
    shouldStop: () => stop,
    fetchHtml: async () => {
      stop = true;
      return `<script>{"itemId":"${row.item_id}","startTime":"${time}"}</script>`;
    },
  });
  await expect(
    lookup(job, [row, { ...row, item_id: "188151380609" }]),
  ).rejects.toThrow("Stopping");
  const restart = createEbayListingTimeQueue({
    store,
    clock: () => Date.parse("2026-10-30T09:11:00Z"),
    seen: () => false,
    fetchHtml: async () => "",
  });
  const result = await restart(job, []);
  expect(result.find((item) => item.item_id === row.item_id)?.listed_at).toBe(
    time,
  );
  expect(store.setting(`ebayTimePending:${job.id}`)).toContain("188151380609");
});
