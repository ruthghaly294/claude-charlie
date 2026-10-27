import { describe, it, expect, vi } from "vitest";
import { telegramSender } from "../src/telegram.js";
describe("Telegram delivery", () => {
  it("uses plain text and rejects API failures without disclosing credentials", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: false }), { status: 400 }),
      );
    const send = telegramSender(
      "123456:abcdefghijklmnopqrstuvwxyz",
      "1234",
      fetcher,
    );
    await expect(send("<b>Chair</b>")).rejects.toThrow(
      "Telegram delivery failed",
    );
    const call = fetcher.mock.calls[0];
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      chat_id: "1234",
      text: "<b>Chair</b>",
    });
  });
  it("requires a successful Telegram response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })),
      );
    await expect(
      telegramSender(
        "123456:abcdefghijklmnopqrstuvwxyz",
        "1234",
        fetcher,
      )("Chair"),
    ).resolves.toBeUndefined();
  });
});
