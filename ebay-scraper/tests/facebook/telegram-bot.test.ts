import { describe, expect, it } from "vitest";
import { WatchStore, alertText, runWatchCycle } from "../../src/watcher.js";
import { handleWatchlistInput } from "../../src/watchlist-bot.js";
import { publishResearch, syncWatchlist } from "../../src/watchlist-sync.js";
import { telegramSender } from "../../src/telegram.js";
import { listingSchema } from "../../src/contract.js";
import {
  watchlistRowSchema,
  type WatchlistEntry,
  type WatchlistRepository,
} from "../../src/supabase-watchlist.js";
import type { TelegramOptions } from "../../src/telegram-options.js";

const listing = (id: string, price: number) =>
  listingSchema.parse({
    position: 1,
    item_id: id,
    title: "Black chesterfield captain chair",
    url: `https://www.facebook.com/marketplace/item/${id}/`,
    image: "https://scontent-lhr11-1.xx.fbcdn.net/v/t39.84726-6/chair.jpg",
    price: { value: price, currency: "GBP", symbol: "£", raw: `£${price}` },
    location: "Dunmurry · approx. 9.7 km (straight-line)",
  });

function facebookBot() {
  const rows = new Map<string, WatchlistEntry>();
  const repository: WatchlistRepository = {
    platform: "facebook",
    list: async () => [...rows.values()].filter((row) => !row.deleted_at),
    create: async (id, chat, input) => {
      const row = watchlistRowSchema.parse({
        provider: "facebook",
        latitude: 54.5948,
        longitude: -5.8901,
        radius_km: 40,
        location_name: "Ballyhackamore, East Belfast",
        ...input,
        id,
        telegram_chat_id: chat,
        revision: 1,
        research_requested_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      rows.set(id, row);
      return row;
    },
    update: async (id, _chat, revision, patch) => {
      const row = rows.get(id)!;
      if (row.revision !== revision) throw new Error("conflict");
      if (patch.monitor_sold) throw new Error("check_violation");
      const updated = { ...row, ...patch, revision: revision + 1 };
      rows.set(id, updated);
      return updated;
    },
    remove: async (id) => {
      rows.set(id, { ...rows.get(id)!, deleted_at: new Date().toISOString() });
    },
  };
  const store = new WatchStore(":memory:");
  const messages: { text: string; options?: TelegramOptions }[] = [];
  let updateId = 1;
  const run = (input: { text?: string; data?: string }) =>
    handleWatchlistInput(
      { ...input, updateId: updateId++ },
      "123",
      store,
      repository,
      async (text, options) => {
        messages.push({ text, ...(options ? { options } : {}) });
      },
    );
  return { rows, store, messages, run };
}

describe("Facebook Marketplace Telegram bot", () => {
  it("researches current asking prices nearby, then watches only for new local listings", async () => {
    const f = facebookBot();
    try {
      await f.run({ text: "Chesterfield captain chair" });
      const row = [...f.rows.values()][0]!;
      expect(row).toMatchObject({ interval_minutes: 5, monitor_active: false });
      expect(f.messages.at(-1)?.text).toContain("asking prices");
      expect(f.store.list()).toEqual([
        expect.objectContaining({
          mode: "active",
          once: true,
          notifyNew: false,
          provider: "facebook",
          radiusKm: 40,
        }),
      ]);
      await runWatchCycle(
        f.store,
        async () => [listing("1", 100), listing("2", 150), listing("3", 400)],
        async () => {},
      );
      publishResearch(f.store, [...f.rows.values()], Date.now());
      const sent: string[] = [];
      await runWatchCycle(
        f.store,
        async () => [],
        async (text) => {
          sent.push(text);
        },
      );
      expect(sent.join("\n")).toMatch(
        /3 current listings within 40 km of Ballyhackamore, East Belfast[\s\S]*Lowest £100\.00 · median £150\.00 · highest £400\.00[\s\S]*not completed sales/,
      );

      await f.run({ data: `w:${row.id}:1:yes` });
      expect(f.rows.get(row.id)).toMatchObject({
        monitor_active: true,
        monitor_sold: false,
      });
      expect(
        f.store.list().filter((job) => job.notifyNew && !job.once),
      ).toHaveLength(1);
    } finally {
      f.store.close();
    }
  });

  it("edits the search radius and shows the area instead of eBay delivery filters", async () => {
    const f = facebookBot();
    try {
      await f.run({ text: "Chesterfield captain chair" });
      const row = [...f.rows.values()][0]!;
      await f.run({ data: `w:${row.id}:1:edit` });
      const labels = f.messages
        .at(-1)
        ?.options?.buttons?.flat()
        .map((b) => b.text);
      expect(labels).toContain("Radius");
      expect(labels).not.toContain("Delivery");
      await f.run({ data: `w:${row.id}:1:radius` });
      await f.run({ text: "60" });
      expect(f.messages.at(-1)?.text).toContain("1 to 40");
      await f.run({ text: "15" });
      expect(f.rows.get(row.id)?.radius_km).toBe(15);
      expect(f.messages.at(-1)?.text).toContain(
        "Within 15 km of Ballyhackamore, East Belfast",
      );
      expect(f.store.list()[0]?.radiusKm).toBe(15);
    } finally {
      f.store.close();
    }
  });
});

it("formats Facebook alerts with asking price, place and straight-line distance", () => {
  const store = new WatchStore(":memory:");
  try {
    const job = store.create({
      name: "Chair — active",
      query: "chesterfield captain chair",
      mode: "active",
      provider: "facebook",
    });
    const text = alertText(job, listing("1", 495), Date.UTC(2026, 9, 27));
    expect(text).toContain("New Facebook Marketplace listing");
    expect(text).toContain("Asking price £495");
    expect(text).toContain("Dunmurry · approx. 9.7 km (straight-line)");
    expect(text).toContain("https://www.facebook.com/marketplace/item/1/");
  } finally {
    store.close();
  }
});

it("asks for a Facebook sign-in rather than an eBay one when Facebook logs out", () => {
  const store = new WatchStore(":memory:");
  try {
    const job = store.create({
      name: "Chair — active",
      query: "chair",
      mode: "active",
      provider: "facebook",
    });
    store.failure(job.id, "UPSTREAM_AUTH_REQUIRED", Date.now());
    const [warning] = store.pending(Date.now() + 1);
    expect(warning?.payload).toContain("Facebook Marketplace monitoring");
    expect(warning?.payload).toContain("Facebook requires sign-in");
    expect(warning?.payload).not.toContain("eBay");
  } finally {
    store.close();
  }
});

it("sends Facebook listing photos with an Open listing button, but not other Facebook pages", async () => {
  const bodies: Record<string, unknown>[] = [];
  const send = telegramSender(
    "123456:abcdefghijklmnopqrstuvwxyz",
    "123",
    async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }));
    },
  );
  await send("chair", {
    image: "https://scontent-lhr11-1.xx.fbcdn.net/v/t39.84726-6/chair.jpg",
    url: "https://www.facebook.com/marketplace/item/1083292931250072/",
  });
  await send("login", {
    image: "https://evil.example/fbcdn.net/x.jpg",
    url: "https://www.facebook.com/login/",
  });
  expect(bodies[0]).toMatchObject({
    photo: "https://scontent-lhr11-1.xx.fbcdn.net/v/t39.84726-6/chair.jpg",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Open listing",
            url: "https://www.facebook.com/marketplace/item/1083292931250072/",
          },
        ],
      ],
    },
  });
  expect(bodies[1]).not.toHaveProperty("photo");
  expect(bodies[1]).not.toHaveProperty("reply_markup");
});

it("keeps Facebook research separate from ongoing monitoring of the same search", () => {
  const store = new WatchStore(":memory:");
  try {
    const entry = watchlistRowSchema.parse({
      id: "d76774de-6fea-4d07-8adf-227d57e03da6",
      telegram_chat_id: "123",
      provider: "facebook",
      latitude: 54.5948,
      longitude: -5.8901,
      radius_km: 40,
      location_name: "Ballyhackamore, East Belfast",
      name: "Chair",
      query: "chesterfield captain chair",
      interval_minutes: 5,
      monitor_active: true,
      revision: 2,
      research_requested_at: "2026-10-27T18:00:00Z",
      created_at: "2026-10-27T18:00:00Z",
      updated_at: "2026-10-27T18:00:00Z",
    });
    syncWatchlist(store, [entry]);
    expect(
      store.list().map((job) => [job.mode, job.once, job.notifyNew]),
    ).toEqual([
      ["active", false, true],
      ["active", true, false],
    ]);
  } finally {
    store.close();
  }
});
