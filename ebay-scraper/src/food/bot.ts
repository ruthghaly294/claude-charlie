import { z } from "zod";
import type { TelegramSend } from "../telegram-options.js";
import type { WatchStore } from "../watcher.js";

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

export async function foodCommands(options: {
  token: string;
  chatId: string;
  store: WatchStore;
  send: TelegramSend;
  requestPrices: () => void;
  fetcher?: typeof fetch;
}): Promise<void> {
  const offset = Number(options.store.setting("foodTelegramOffset") ?? "0");
  const response = await (options.fetcher ?? fetch)(
    `https://api.telegram.org/bot${options.token}/getUpdates?offset=${offset}&timeout=0&limit=50`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) throw new Error("Telegram unavailable");
  for (const update of updatesSchema.parse(await response.json()).result) {
    const message = update.message;
    options.store.setSetting(
      "foodTelegramOffset",
      String(update.update_id + 1),
    );
    if (
      message?.chat.type !== "private" ||
      String(message.chat.id) !== options.chatId
    )
      continue;
    if (/^\/?prices?\b/i.test(message.text?.trim() ?? "")) {
      options.requestPrices();
      await options.send(
        "Checking Tesco, Asda, Sainsbury's, Lidl, Spar and Eurospar now. The comparison arrives in about 2 minutes.",
        { keyboard: [["Prices"]] },
      );
    } else
      await options.send(
        "Pepsi Max price tracker for Northern Ireland. I compare can multipacks by pence per 100 ml, including Clubcard, Nectar and Lidl Plus prices, and send the comparison every Monday and Thursday morning. Tap Prices for a fresh check.",
        { keyboard: [["Prices"]] },
      );
  }
}
