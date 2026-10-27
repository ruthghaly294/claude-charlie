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
