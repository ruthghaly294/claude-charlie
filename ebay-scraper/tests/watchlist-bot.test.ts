import { describe, expect, it } from "vitest";
import { WatchStore } from "../src/watcher.js";
import { handleWatchlistInput } from "../src/watchlist-bot.js";
import {
  watchlistRowSchema,
  type WatchlistEntry,
  type WatchlistRepository,
} from "../src/supabase-watchlist.js";
import type { TelegramOptions } from "../src/telegram-options.js";
function fixture() {
  const rows = new Map<string, WatchlistEntry>();
  const repository: WatchlistRepository = {
    list: async () => [...rows.values()].filter((row) => !row.deleted_at),
    create: async (id, chat, input) => {
      if (rows.has(id)) return rows.get(id)!;
      const row = watchlistRowSchema.parse({
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
      const updated = { ...row, ...patch, revision: revision + 1 };
      rows.set(id, updated);
      return updated;
    },
    remove: async (id) => {
      const row = rows.get(id)!;
      rows.set(id, { ...row, deleted_at: new Date().toISOString() });
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
describe("Telegram watch list conversation", () => {
  it("saves a typed item for research, then starts and removes monitoring using buttons", async () => {
    const f = fixture();
    try {
      await f.run({
        text: "Top 3 Differences in Radiology OBrien second edition",
      });
      const row = [...f.rows.values()][0]!;
      expect(row.monitor_active).toBe(false);
      expect(f.store.list()).toHaveLength(1);
      expect(f.messages.at(-1)?.text).toContain("research");
      await f.run({ data: `w:${row.id}:1:yes` });
      expect(f.rows.get(row.id)?.monitor_active).toBe(true);
      expect(f.store.list()).toHaveLength(2);
      await f.run({ text: "Watch list" });
      expect(f.messages.at(-1)?.options?.buttons?.flat().length).toBe(1);
      await f.run({ data: `w:${row.id}:2:remove` });
      expect(f.store.list()).toHaveLength(0);
      expect(f.rows.get(row.id)?.deleted_at).not.toBeNull();
    } finally {
      f.store.close();
    }
  });
  it("edits filters without treating the typed price as a new product", async () => {
    const f = fixture();
    try {
      await f.run({ text: "Radiology second edition" });
      const row = [...f.rows.values()][0]!;
      await f.run({ data: `w:${row.id}:1:price` });
      await f.run({ text: "35" });
      expect(f.rows.size).toBe(1);
      expect(f.rows.get(row.id)?.max_price).toBe(35);
      expect(f.store.list()[0]?.maxPrice).toBe(35);
    } finally {
      f.store.close();
    }
  });
  it("rejects stale buttons and can cancel a persistent edit", async () => {
    const f = fixture();
    try {
      await f.run({ text: "Radiology second edition" });
      const row = [...f.rows.values()][0]!;
      await f.run({ data: `w:${row.id}:99:remove` });
      expect(f.store.list()).toHaveLength(1);
      expect(f.messages.at(-1)?.text).toContain("changed");
      await f.run({ data: `w:${row.id}:1:query` });
      await f.run({ text: "/cancel" });
      expect(f.store.setting("watchlistConversation")).toBe("");
    } finally {
      f.store.close();
    }
  });
});

it("clears a preset comparison group when the user changes the product search", async () => {
  const f = fixture();
  try {
    await f.run({ text: "Chesterfield captain chairs" });
    const row = [...f.rows.values()][0]!;
    f.rows.set(row.id, { ...row, market_profile: "chairs" });
    await f.run({ data: `w:${row.id}:1:query` });
    await f.run({ text: "iPhone 15" });
    expect(f.rows.get(row.id)?.query).toBe("iPhone 15");
    expect(f.rows.get(row.id)?.market_profile).toBeNull();
  } finally {
    f.store.close();
  }
});
