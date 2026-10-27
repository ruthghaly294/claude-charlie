import { afterEach, describe, it, expect, vi } from "vitest";
import { telegramCommands } from "../src/telegram.js";
import { WatchStore } from "../src/watcher.js";
afterEach(() => vi.unstubAllGlobals());
describe("Telegram bot commands", () => {
  it("replies only to the paired private chat and persists the update cursor", async () => {
    const store = new WatchStore(":memory:");
    const sent: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            result: [
              {
                update_id: 10,
                message: {
                  chat: { id: 999, type: "private" },
                  text: "/status",
                },
              },
              {
                update_id: 11,
                message: {
                  chat: { id: 123, type: "private" },
                  text: "/market pokemon 12",
                },
              },
            ],
          }),
        ),
      ),
    );
    try {
      await telegramCommands(
        "123:abcdefghijklmnopqrstuvwxyz",
        "123",
        store,
        async (text) => {
          sent.push(text);
        },
      );
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain("365-day sold sample");
      expect(store.setting("telegramOffset")).toBe("12");
    } finally {
      store.close();
    }
  });
});

it("ignores callbacks unless both the sender and private chat match the paired user", async () => {
  const store = new WatchStore(":memory:");
  const list = vi.fn().mockResolvedValue([]);
  const repository: import("../src/supabase-watchlist.js").WatchlistRepository =
    {
      list,
      create: async () => {
        throw new Error("unexpected");
      },
      update: async () => {
        throw new Error("unexpected");
      },
      remove: async () => {
        throw new Error("unexpected");
      },
    };
  const send = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 15,
              callback_query: {
                id: "foreign",
                from: { id: 999 },
                data: "w:d76774de-6fea-4d07-8adf-227d57e03da6:1:remove",
                message: { chat: { id: 123, type: "private" } },
              },
            },
            {
              update_id: 16,
              callback_query: {
                id: "group",
                from: { id: 123 },
                data: "w:d76774de-6fea-4d07-8adf-227d57e03da6:1:remove",
                message: { chat: { id: 123, type: "group" } },
              },
            },
          ],
        }),
      ),
    ),
  );
  try {
    await telegramCommands(
      "123:abcdefghijklmnopqrstuvwxyz",
      "123",
      store,
      send,
      repository,
    );
    expect(list).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(store.setting("telegramOffset")).toBe("17");
  } finally {
    store.close();
  }
});
