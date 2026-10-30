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

it("sends the listing photo with its caption and a direct listing button", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  const send = telegramSender(
    "123456:abcdefghijklmnopqrstuvwxyz",
    "1234",
    fetcher,
  );
  await send("New listing: Charizard PSA 9", {
    image: "https://i.ebayimg.com/images/g/example/s-l500.jpg",
    url: "https://www.ebay.co.uk/itm/123",
  });
  expect(fetcher.mock.calls[0]?.[0]).toContain("/sendPhoto");
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
    photo: "https://i.ebayimg.com/images/g/example/s-l500.jpg",
    caption: "New listing: Charizard PSA 9",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🛒 Buy on eBay", url: "https://www.ebay.co.uk/itm/123" }],
      ],
    },
  });
});

it("keeps a direct listing button when the listing has no usable photo", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  await telegramSender(
    "123456:abcdefghijklmnopqrstuvwxyz",
    "1234",
    fetcher,
  )("Listing without a photo", {
    image: null,
    url: "https://www.ebay.co.uk/itm/123",
  });
  expect(fetcher.mock.calls[0]?.[0]).toContain("/sendMessage");
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
    reply_markup: {
      inline_keyboard: [[{ url: "https://www.ebay.co.uk/itm/123" }]],
    },
  });
});

it("does not send untrusted photo URLs or listing buttons to Telegram", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  await telegramSender(
    "123456:abcdefghijklmnopqrstuvwxyz",
    "1234",
    fetcher,
  )("Untrusted metadata", {
    image: "https://i.ebayimg.com.attacker.example/image.jpg",
    url: "https://www.ebay.co.uk.attacker.example/itm/123",
  });
  expect(fetcher.mock.calls[0]?.[0]).toContain("/sendMessage");
  const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
  expect(body).not.toHaveProperty("photo");
  expect(body).not.toHaveProperty("reply_markup");
});

it("renders watch-list actions as Telegram callback buttons", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  await telegramSender(
    "123456:abcdefghijklmnopqrstuvwxyz",
    "1234",
    fetcher,
  )("Keep watching?", {
    buttons: [
      [
        {
          text: "Yes, keep watching",
          data: "w:d76774de-6fea-4d07-8adf-227d57e03da6:1:yes",
        },
      ],
    ],
  });
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
    text: "Keep watching?",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Yes, keep watching",
            callback_data: "w:d76774de-6fea-4d07-8adf-227d57e03da6:1:yes",
          },
        ],
      ],
    },
  });
});
