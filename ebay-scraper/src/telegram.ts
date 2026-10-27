export function telegramSender(
  token: string,
  chatId: string,
  fetcher: typeof fetch = fetch,
): (text: string) => Promise<void> {
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token) || !/^-?\d+$/.test(chatId))
    throw new Error("Invalid Telegram configuration");
  return async (text: string): Promise<void> => {
    try {
      const response = await fetcher(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: text.slice(0, 4000),
            link_preview_options: { is_disabled: true },
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
  send: (text: string) => Promise<void>,
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
      const message = update.message;
      if (
        message?.chat.type === "private" &&
        String(message.chat.id) === chatId &&
        message.text?.startsWith("/")
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
        } else if (text.startsWith("/status")) {
          await send(
            "eBay monitor status\n" +
              store
                .list()
                .map(
                  (w) =>
                    `${w.name}: ${w.lastError ?? (w.baselined ? "OK" : "baseline pending")} · ${w.resultCount} results · every ${w.intervalMinutes} min · last success ${w.lastSuccess ? new Date(w.lastSuccess).toISOString() : "pending"}`,
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
