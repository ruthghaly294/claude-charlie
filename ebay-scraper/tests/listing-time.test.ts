import { expect, it } from "vitest";
import { listingSchema } from "../src/contract.js";
import { alertText, WatchStore } from "../src/watcher.js";
const now = Date.parse("2026-10-28T12:00:00Z");
const row = (id: string, listed_at?: string) =>
  listingSchema.parse({
    position: 1,
    item_id: id,
    title: "Aloe vera",
    url: `https://www.facebook.com/marketplace/item/${id}/`,
    ...(listed_at ? { listed_at } : {}),
  });
it("suppresses unseen old or undated Facebook listings and alerts genuinely new listings", () => {
  const store = new WatchStore(":memory:");
  const job = store.create({
    name: "plants",
    query: "plants",
    provider: "facebook",
    mode: "active",
  });
  store.record(job.id, [], now - 300000);
  store.record(
    job.id,
    [
      row("1", "2026-10-21T12:00:00Z"),
      row("2", "2026-10-28T11:58:00Z"),
      row("3"),
    ],
    now,
  );
  expect(store.pending(now).map((x) => x.payload)).toHaveLength(1);
  expect(store.pending(now)[0]?.payload).toContain("2/");
  store.close();
});
it("shows seller listing time and age separately from detection time", () => {
  const store = new WatchStore(":memory:");
  const job = store.create({ name: "plants", query: "plants", mode: "active" });
  expect(alertText(job, row("2", "2026-10-28T11:48:00Z"), now)).toContain(
    "Listed 28 Oct 2026, 11:48:00 GMT · 12 minutes ago",
  );
  expect(alertText(job, row("2"), now)).toContain("Listing time unavailable");
  store.close();
});

it("retries an undated Facebook listing when its timestamp becomes available", () => {
  const store = new WatchStore(":memory:");
  const job = store.create({
    name: "plants",
    query: "plants",
    mode: "active",
    provider: "facebook",
  });
  store.record(job.id, [], now - 300000);
  store.record(job.id, [row("4")], now - 60000);
  expect(store.hasSeen(job.id, "4")).toBe(false);
  store.record(job.id, [row("4", "2026-10-28T11:59:00Z")], now);
  expect(store.pending(now)).toHaveLength(1);
  store.close();
});

it("alerts a recently listed Facebook match surfaced late after several successful scans", () => {
  const store = new WatchStore(":memory:");
  const job = store.create({
    name: "plants",
    query: "plants",
    provider: "facebook",
    mode: "active",
  });
  store.record(job.id, [], now - 3600000);
  store.record(job.id, [], now - 300000);
  store.record(job.id, [row("5", "2026-10-28T11:15:00Z")], now);
  expect(store.pending(now)).toHaveLength(1);
  store.close();
});

it("preserves verified times when later search results omit metadata while refreshing other listing fields", () => {
  const store = new WatchStore(":memory:");
  const job = store.create({ name: "chairs", query: "chairs", mode: "active" });
  const detected_at = "2026-10-28T11:59:00.000Z";
  store.record(
    job.id,
    [{ ...row("188151380608", "2026-10-28T11:48:00.000Z"), detected_at }],
    now,
  );
  store.record(
    job.id,
    [{ ...row("188151380608"), title: "Updated chair title" }],
    now + 120000,
  );
  const saved = store
    .listings(job.id)
    .find((item) => item.item_id === "188151380608");
  expect(saved).toMatchObject({
    listed_at: "2026-10-28T11:48:00.000Z",
    detected_at,
    title: "Updated chair title",
  });
  store.close();
});

it("records a recovered timestamp without claiming that a failed search succeeded", () => {
  const store = new WatchStore(":memory:");
  const job = store.create({ name: "chairs", query: "chairs", mode: "active" });
  store.record(job.id, [], now - 120000);
  store.failure(job.id, "UPSTREAM_ACCESS_DENIED", now - 60000);
  const before = store.get(job.id)!;
  store.recordResolvedListings(
    job.id,
    [
      {
        ...row("267605857214", "2026-03-14T11:04:38.000Z"),
        detected_at: "2026-10-28T11:59:00.000Z",
      },
    ],
    now,
  );
  const after = store.get(job.id)!;
  expect(after).toMatchObject({
    lastSuccess: before.lastSuccess,
    lastError: before.lastError,
    nextRun: before.nextRun,
    resultCount: before.resultCount,
  });
  expect(store.pending(now)).toHaveLength(1);
  expect(store.pending(now)[0]?.payload).toContain("14 Mar 2026");
  store.close();
});
