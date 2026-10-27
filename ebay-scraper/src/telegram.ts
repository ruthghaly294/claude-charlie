import { handleWatchlistInput } from "./watchlist-bot.js";
import type { WatchlistRepository } from "./supabase-watchlist.js";
import type { TelegramOptions, TelegramSend } from "./telegram-options.js";
import { markets } from "./query.js";

export type ListingMedia = { image: string | null; url: string };

function safeUrl(
  value: string | null | undefined,
  image: boolean,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname;
    if (url.protocol !== "https:" || url.username || url.password)
      return undefined;
    if (
      image
        ? host !== "i.ebayimg.com"
        : !Object.keys(markets).some((market) => host === `www.ebay.${market}`)
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function telegramSender(
  token: string,
  chatId: string,
  fetcher: typeof fetch = fetch,
): TelegramSend {
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token) || !/^-?\d+$/.test(chatId))
    throw new Error("Invalid Telegram configuration");
  return async (text: string, media?: TelegramOptions): Promise<void> => {
    const photo = safeUrl(media?.image, true);
    const url = safeUrl(media?.url, false);
    try {
      const response = await fetcher(
        `https://api.telegram.org/bot${token}/${photo ? "sendPhoto" : "sendMessage"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            ...(photo
              ? { photo, caption: text.slice(0, 1024) }
              : {
                  text: text.slice(0, 4000),
                  link_preview_options: { is_disabled: true },
                }),
            ...(media?.buttons || url
              ? {
                  reply_markup: {
                    inline_keyboard: [
                      ...(url ? [[{ text: "Open listing", url }]] : []),
                      ...(media?.buttons ?? []).map((row) =>
                        row.map((button) => ({
                          text: button.text,
                          callback_data: button.data,
                        })),
                      ),
                    ],
                  },
                }
              : media?.keyboard
                ? {
                    reply_markup: {
                      keyboard: media.keyboard,
                      resize_keyboard: true,
                    },
                  }
                : {}),
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const body: unknown = await response.json();
      if (
        !response.ok ||
        typeof body !== "object" ||
        body === null ||
        !("ok" in body) ||
        body.ok !== true
      )
        throw new Error("Rejected");
    } catch {
      throw new Error("Telegram delivery failed");
    }
  };
}

import { z } from "zod";
import type { WatchStore } from "./watcher.js";
const updatesSchema = z.object({
  ok: z.literal(true),
  result: z.array(
    z.object({
      update_id: z.number().int(),
      callback_query: z
        .object({
          id: z.string(),
          data: z.string().optional(),
          from: z.object({ id: z.number() }),
          message: z
            .object({ chat: z.object({ id: z.number(), type: z.string() }) })
            .optional(),
        })
        .optional(),
      message: z
        .object({
          chat: z.object({ id: z.number(), type: z.string() }),
          text: z.string().optional(),
        })
        .optional(),
    }),
  ),
});
export async function telegramCommands(
  token: string,
  chatId: string,
  store: WatchStore,
  send: TelegramSend,
  repository?: WatchlistRepository,
): Promise<void> {
  try {
    const offset = Number(store.setting("telegramOffset") ?? "0");
    const response = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=0&limit=50`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok) throw new Error("Telegram unavailable");
    const data = updatesSchema.parse(await response.json());
    for (const update of data.result) {
      const callback = update.callback_query;
      if (
        repository &&
        callback?.data &&
        callback.message?.chat.type === "private" &&
        String(callback.message.chat.id) === chatId &&
        String(callback.from.id) === chatId
      ) {
        await fetch(
          `https://api.telegram.org/bot${token}/answerCallbackQuery`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ callback_query_id: callback.id }),
            signal: AbortSignal.timeout(10000),
          },
        ).catch(() => {});
        await handleWatchlistInput(
          { data: callback.data, updateId: update.update_id },
          chatId,
          store,
          repository,
          send,
        );
        store.setSetting("telegramOffset", String(update.update_id + 1));
        continue;
      }
      const message = update.message;
      if (
        repository &&
        message?.chat.type === "private" &&
        String(message.chat.id) === chatId &&
        message.text
      ) {
        if (
          await handleWatchlistInput(
            { text: message.text, updateId: update.update_id },
            chatId,
            store,
            repository,
            send,
          )
        ) {
          store.setSetting("telegramOffset", String(update.update_id + 1));
          continue;
        }
      }
      if (
        message?.chat.type === "private" &&
        String(message.chat.id) === chatId &&
        (message.text?.startsWith("/") ||
          message.text?.toLowerCase() === "status")
      ) {
        const text = message.text.toLowerCase();
        if (text.startsWith("/market")) {
          const profile =
            text.includes("pokemon") || text.includes("charizard")
              ? "charizard_psa9_base"
              : "chairs";
          const days = /\b12\b/.test(text)
            ? 365
            : /\b6\b/.test(text)
              ? 180
              : 90;
          await send(store.research(profile, days));
        } else if (text.startsWith("/status") || text === "status") {
          await send(
            "eBay monitor status\n" +
              store
                .list()
                .map(
                  (w) =>
                    `${w.name}: ${w.lastError ?? (w.baselined ? "OK" : "baseline pending")} · ${w.resultCount} results · ${w.once ? (w.baselined ? "research complete; not polling" : "one-off research queued") : `every ${w.intervalMinutes} min`} · last success ${w.lastSuccess ? new Date(w.lastSuccess).toISOString() : "pending"}`,
                )
                .join("\n"),
          );
        } else
          await send(
            "eBay alerts connected. Commands:\n/status\n/market chairs 3\n/market pokemon 3\nUse 6 or 12 for longer requested windows. Research reports actual observed coverage.",
          );
      }
      store.setSetting("telegramOffset", String(update.update_id + 1));
    }
  } catch {
    throw new Error("Telegram commands unavailable");
  }
}
