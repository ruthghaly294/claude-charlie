import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TelegramOptions, TelegramSend } from "../telegram-options.js";
import type { WatchStore } from "../watcher.js";
import { fuelSchema, sameName } from "./listing.js";
import type { CarDraft, CarWatch, CarWatchlist } from "./watchlist.js";

const photoHosts = ["m.atcdn.co.uk", "image.usedcarsni.com"];
const safePhoto = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && photoHosts.includes(url.hostname);
  } catch {
    return false;
  }
};

export type CarSend = (caption: string, images: string[]) => Promise<void>;

export function carSender(
  token: string,
  chatId: string,
  fetcher: typeof fetch = fetch,
): CarSend {
  return async (caption, images) => {
    const photos = images.filter(safePhoto).slice(0, 4);
    const [method, body] =
      photos.length > 1
        ? [
            "sendMediaGroup",
            {
              media: photos.map((media, i) => ({
                type: "photo",
                media,
                ...(i === 0 ? { caption, parse_mode: "HTML" } : {}),
              })),
            },
          ]
        : photos[0]
          ? ["sendPhoto", { photo: photos[0], caption, parse_mode: "HTML" }]
          : [
              "sendMessage",
              {
                text: caption,
                parse_mode: "HTML",
                link_preview_options: { is_disabled: true },
              },
            ];
    const response = await fetcher(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, ...body }),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok) throw new Error("Telegram delivery failed");
  };
}

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
      callback_query: z
        .object({
          id: z.string(),
          data: z.string().optional(),
          from: z.object({ id: z.number() }),
        })
        .optional(),
    }),
  ),
});
const conversationSchema = z.object({
  step: z.enum(["make", "model", "fuel", "age"]),
  make: z.object({ id: z.string(), name: z.string() }).optional(),
  model: z.string().optional(),
  fuel: fuelSchema.nullable().optional(),
});
type Conversation = z.infer<typeof conversationSchema>;
type Option = { id: string; name: string };

const menu = [
  ["Market", "Car list"],
  ["Add car", "Refresh"],
];
const fuelKeyboard = [
  ["Any fuel", "Petrol", "Diesel"],
  ["Hybrid", "Plug-in hybrid", "Electric"],
  ["Cancel"],
];
const name = (watch: CarWatch) => `${watch.make} ${watch.model}`;
const summary = (watch: CarWatch) =>
  `${name(watch)} · ${watch.fuel ?? "any fuel"} · under ${watch.max_age_years} years · alerts ${watch.alerts_active ? "on" : "paused"}`;
const help =
  "Car market tracker. For each car on your list I check Used Cars NI and AutoTrader every 10 minutes and alert you to new dealer cars within 60 miles of Belfast, with photos, the link and when each was listed. Write-offs (Cat S, N and older categories), damaged cars, non-runners and private sellers are excluded everywhere. Every morning I rescan the whole UK market and price each car by fuel type, age and every 10,000 miles. Tap Add car to track another model, Car list to manage them, or Market for a price grid.";

export async function carCommands(options: {
  token: string;
  chatId: string;
  store: WatchStore;
  watchlist: CarWatchlist;
  send: TelegramSend;
  catalogue: (make?: Option) => Promise<Option[]>;
  report: (watch: CarWatch) => string[];
  refresh: (watch?: CarWatch) => void;
  fetcher?: typeof fetch;
}): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  const api = `https://api.telegram.org/bot${options.token}`;
  const offset = Number(options.store.setting("carsTelegramOffset") ?? "0");
  const response = await fetcher(
    `${api}/getUpdates?offset=${offset}&timeout=0&limit=50`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) throw new Error("Telegram unavailable");
  const say = (text: string, extra: TelegramOptions = { keyboard: menu }) =>
    options.send(text, extra);
  const converse = (state: Conversation | undefined) =>
    options.store.setSetting(
      "carsConversation",
      state ? JSON.stringify(state) : "",
    );
  const showMarket = async (watch: CarWatch) => {
    for (const part of options.report(watch))
      await say(part, { html: true, keyboard: menu });
  };
  for (const update of updatesSchema.parse(await response.json()).result) {
    options.store.setSetting(
      "carsTelegramOffset",
      String(update.update_id + 1),
    );
    const callback = update.callback_query;
    if (callback) {
      await fetcher(`${api}/answerCallbackQuery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callback_query_id: callback.id }),
        signal: AbortSignal.timeout(15000),
      }).catch(() => undefined);
      if (String(callback.from.id) !== options.chatId) continue;
      const [, action, id] = callback.data?.split(":") ?? [];
      const watch = (await options.watchlist.list(options.chatId)).find(
        (w) => w.id === id,
      );
      if (!watch) {
        await say("That car is no longer on your list.");
        continue;
      }
      if (action === "market") await showMarket(watch);
      else if (action === "pause" || action === "resume") {
        await options.watchlist.update(watch.id, options.chatId, {
          alerts_active: action === "resume",
        });
        await say(
          `${name(watch)}: new-listing alerts ${action === "resume" ? "on" : "paused"}. Market research continues either way.`,
        );
      } else if (action === "remove") {
        await options.watchlist.remove(watch.id, options.chatId);
        await say(
          `Removed ${name(watch)}. Its market history is kept on the server.`,
        );
      }
      continue;
    }
    const message = update.message;
    if (
      message?.chat.type !== "private" ||
      String(message.chat.id) !== options.chatId
    )
      continue;
    const text = message.text?.trim() ?? "";
    const saved = options.store.setting("carsConversation");
    const state = saved
      ? conversationSchema.safeParse(JSON.parse(saved)).data
      : undefined;
    if (/^\/?cancel\b/i.test(text)) {
      converse(undefined);
      await say("Cancelled.");
    } else if (/^\/?add car\b/i.test(text)) {
      converse({ step: "make" });
      await say("Which make? For example: Toyota", {
        keyboard: [["Cancel"]],
      });
    } else if (state?.step === "make") {
      const make = (await options.catalogue()).find((m) =>
        sameName(m.name, text),
      );
      if (!make) {
        await say(
          `I couldn't find "${text}" on Used Cars NI. Type the make as the site writes it, for example Toyota, Volkswagen or Land Rover.`,
          { keyboard: [["Cancel"]] },
        );
        continue;
      }
      const models = await options.catalogue(make);
      converse({ step: "model", make });
      await say(
        `Which ${make.name} model? On sale now: ${models.map((m) => m.name).join(", ")}.`,
        { keyboard: [["Cancel"]] },
      );
    } else if (state?.step === "model" && state.make) {
      const model = (await options.catalogue(state.make)).find((m) =>
        sameName(m.name, text),
      );
      if (!model) {
        await say(
          `I couldn't find a ${state.make.name} "${text}". Pick one of the models listed above.`,
          { keyboard: [["Cancel"]] },
        );
        continue;
      }
      converse({ ...state, step: "fuel", model: model.name });
      await say("Which fuel type?", { keyboard: fuelKeyboard });
    } else if (state?.step === "fuel") {
      const fuel = /^any/i.test(text) ? null : fuelSchema.safeParse(text).data;
      if (fuel === undefined) {
        await say("Pick a fuel type from the buttons.", {
          keyboard: fuelKeyboard,
        });
        continue;
      }
      converse({ ...state, step: "age", fuel });
      await say(
        "Maximum age in years? Tap one or type a number from 1 to 20.",
        { keyboard: [["8", "5", "10"], ["Cancel"]] },
      );
    } else if (state?.step === "age" && state.make && state.model) {
      const age = Number(text);
      if (!Number.isInteger(age) || age < 1 || age > 20) {
        await say("Type a whole number of years from 1 to 20.", {
          keyboard: [["8", "5", "10"], ["Cancel"]],
        });
        continue;
      }
      const draft: CarDraft = {
        make: state.make.name,
        model: state.model,
        fuel: state.fuel ?? null,
        max_age_years: age,
      };
      const watch = await options.watchlist.create(
        randomUUID(),
        options.chatId,
        draft,
      );
      converse(undefined);
      options.refresh(watch);
      await say(
        `Added ${name(watch)} (${watch.fuel ?? "any fuel"}, under ${watch.max_age_years} years). Its first full market scan starts now and the price grid arrives when it finishes, in about 10 minutes. New-listing alerts start after that scan.`,
      );
    } else if (/^\/?car list\b/i.test(text)) {
      const watches = await options.watchlist.list(options.chatId);
      if (!watches.length) await say("No cars yet. Tap Add car.");
      for (const watch of watches)
        await say(summary(watch), {
          buttons: [
            [
              { text: "Market", data: `car:market:${watch.id}` },
              watch.alerts_active
                ? { text: "Pause alerts", data: `car:pause:${watch.id}` }
                : { text: "Resume alerts", data: `car:resume:${watch.id}` },
              { text: "× Remove", data: `car:remove:${watch.id}` },
            ],
          ],
        });
    } else if (/^\/?market\b/i.test(text)) {
      const watches = await options.watchlist.list(options.chatId);
      if (watches.length === 1 && watches[0]) await showMarket(watches[0]);
      else if (!watches.length) await say("No cars yet. Tap Add car.");
      else
        await say("Which car?", {
          buttons: watches.map((watch) => [
            { text: name(watch), data: `car:market:${watch.id}` },
          ]),
        });
    } else if (/^\/?refresh\b/i.test(text)) {
      options.refresh();
      await say(
        "Rescanning every car on your list across AutoTrader and Used Cars NI. Ask for Market in about 10 minutes.",
      );
    } else await say(help);
  }
}
