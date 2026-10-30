import { expect, it } from "vitest";
import { foodCommands } from "../../src/food/bot.js";
import { WatchStore } from "../../src/watcher.js";

const updates = (...messages: { chat: number; text: string }[]) =>
  (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        result: messages.map((m, i) => ({
          update_id: 10 + i,
          message: { chat: { id: m.chat, type: "private" }, text: m.text },
        })),
      }),
    )) as typeof fetch;

it("checks prices on request from the owner only, and never re-reads old messages", async () => {
  const store = new WatchStore(":memory:");
  try {
    const sent: string[] = [];
    let requested = 0;
    const run = (fetcher: typeof fetch) =>
      foodCommands({
        token: "123456:abcdefghijklmnopqrstuvwxyz",
        chatId: "123",
        store,
        send: async (text) => void sent.push(text),
        requestPrices: () => void requested++,
        fetcher,
      });
    await run(
      updates({ chat: 999, text: "/prices" }, { chat: 123, text: "/prices" }),
    );
    expect(requested).toBe(1);
    expect(sent).toEqual([expect.stringContaining("Checking")]);
    expect(store.setting("foodTelegramOffset")).toBe("12");
    await run(updates({ chat: 123, text: "/start" }));
    expect(requested).toBe(1);
    expect(sent.at(-1)).toContain("Monday and Thursday");
  } finally {
    store.close();
  }
});

it("sends formatted reports to Telegram as HTML", async () => {
  const bodies: Record<string, unknown>[] = [];
  const { telegramSender } = await import("../../src/telegram.js");
  await telegramSender(
    "123456:abcdefghijklmnopqrstuvwxyz",
    "123",
    async (_u, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }));
    },
  )("<b>Pepsi Max</b>", { html: true });
  expect(bodies[0]).toMatchObject({
    text: "<b>Pepsi Max</b>",
    parse_mode: "HTML",
  });
});
