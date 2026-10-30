import { expect, it } from "vitest";
import { listingSchema } from "../src/contract.js";
import { WatchStore, runWatchCycle } from "../src/watcher.js";
const now = Date.parse("2026-10-30T12:00:00Z");
const row = (id: string, at?: number) =>
  listingSchema.parse({
    position: 1,
    item_id: id,
    title: "Chair",
    url: `https://www.ebay.co.uk/itm/${id}`,
    ...(at !== undefined ? { listed_at: new Date(at).toISOString() } : {}),
  });
it.each([undefined, "facebook" as const])(
  "only alerts on verified listings within the configured live window (%s)",
  (provider) => {
    const s = new WatchStore(":memory:");
    s.setSetting("newListingMaxAgeMinutes", "10");
    const j = s.create({
      name: "chairs",
      query: "chairs",
      mode: "active",
      ...(provider ? { provider } : {}),
    });
    s.record(j.id, [], now - 60000);
    s.record(
      j.id,
      [
        row("1", now - 120000),
        row("2", now - 600001),
        row("3"),
        row("4", now + 1),
        row("5", now - 600000),
      ],
      now,
    );
    expect(
      s.pending(now).map((x) => x.payload.match(/\/itm\/(\d+)/)?.[1]),
    ).toEqual(["1", "5"]);
    expect(s.hasSeen(j.id, "3")).toBe(false);
    s.close();
  },
);
it("drops a queued opportunity that ages out before Telegram delivery, but preserves health messages", async () => {
  const s = new WatchStore(":memory:");
  s.setSetting("newListingMaxAgeMinutes", "10");
  const j = s.create({
    name: "chairs",
    query: "chairs",
    mode: "active",
    intervalMinutes: 60,
  });
  s.record(j.id, [], now - 60000);
  s.record(j.id, [row("1", now - 540000)], now);
  s.enqueue(j.id, "health:check", "Health message");
  const sent: string[] = [];
  await runWatchCycle(
    s,
    async () => [],
    async (text) => {
      sent.push(text);
    },
    () => now + 120000,
  );
  expect(sent).toEqual(["Health message"]);
  expect(s.pending(now + 120000)).toEqual([]);
  s.close();
});
it("refreshes the elapsed listing age at send time", async () => {
  const s = new WatchStore(":memory:");
  s.setSetting("newListingMaxAgeMinutes", "10");
  const j = s.create({
    name: "chairs",
    query: "chairs",
    mode: "active",
    intervalMinutes: 60,
  });
  s.record(j.id, [], now - 60000);
  s.record(j.id, [row("1", now - 120000)], now);
  const sent: string[] = [];
  await runWatchCycle(
    s,
    async () => [],
    async (text) => {
      sent.push(text);
    },
    () => now + 60000,
  );
  expect(sent[0]).toContain("3 minutes ago");
  s.close();
});
it("allows an undated result to be verified later, but stops retrying after its discovery window expires", () => {
  const s = new WatchStore(":memory:");
  s.setSetting("newListingMaxAgeMinutes", "10");
  const j = s.create({ name: "chairs", query: "chairs", mode: "active" });
  s.record(j.id, [], now - 60000);
  s.record(j.id, [row("1")], now);
  expect(s.hasSeen(j.id, "1")).toBe(false);
  s.record(j.id, [row("1")], now + 600001);
  expect(s.hasSeen(j.id, "1")).toBe(true);
  expect(s.pending(now + 600001)).toEqual([]);
  s.close();
});

it.each([undefined, "facebook" as const])(
  "catches a verified fresh listing on the initial scan too (%s)",
  (provider) => {
    const s = new WatchStore(":memory:");
    s.setSetting("newListingMaxAgeMinutes", "10");
    const j = s.create({
      name: "chairs",
      query: "chairs",
      mode: "active",
      ...(provider ? { provider } : {}),
    });
    s.record(j.id, [row("1", now - 60000), row("2", now - 86400000)], now);
    expect(s.pending(now)).toHaveLength(1);
    s.close();
  },
);
it("retries future timestamps instead of marking the listing seen forever", () => {
  const s = new WatchStore(":memory:");
  s.setSetting("newListingMaxAgeMinutes", "10");
  const j = s.create({ name: "chairs", query: "chairs", mode: "active" });
  s.record(j.id, [row("1", now + 1)], now);
  expect(s.hasSeen(j.id, "1")).toBe(false);
  s.record(j.id, [row("1", now + 1)], now + 1000);
  expect(s.pending(now + 1000)).toHaveLength(1);
  s.close();
});
it("keeps older and undated rows available for explicitly requested price research", () => {
  const s = new WatchStore(":memory:");
  s.setSetting("newListingMaxAgeMinutes", "10");
  const j = s.create({
    name: "research",
    query: "chairs",
    mode: "active",
    provider: "facebook",
    once: true,
    notifyNew: false,
  });
  s.record(j.id, [row("1"), row("2", now - 86400000)], now);
  expect(s.listings(j.id)).toHaveLength(2);
  expect(s.pending(now)).toEqual([]);
  s.close();
});
