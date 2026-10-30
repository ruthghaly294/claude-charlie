import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { WatchStore } from "./watcher.js";
import type { TelegramOptions, TelegramSend } from "./telegram-options.js";
import { telegramOptionsSchema } from "./telegram-options.js";
import {
  watchlistDraftSchema,
  type WatchlistEntry,
  type WatchlistPatch,
  type WatchlistRepository,
} from "./supabase-watchlist.js";
import { syncWatchlist, watchButton } from "./watchlist-sync.js";

const menu = [
  ["Add item", "Watch list"],
  ["Market research", "Status"],
];
const conversationSchema = z.object({
  field: z.enum([
    "new",
    "query",
    "price",
    "interval",
    "radius",
    "include",
    "exclude",
  ]),
  id: z.uuid().optional(),
  revision: z.number().int().positive().optional(),
  expires: z.number(),
});
const replySchema = z.object({
  updateId: z.number(),
  text: z.string(),
  options: telegramOptionsSchema.optional(),
});
function actions(entry: WatchlistEntry): TelegramOptions {
  const button = (text: string, action: string) => ({
    text,
    data: watchButton(entry, action),
  });
  return {
    buttons: [
      [button("Research now", "research"), button("Edit", "edit")],
      [
        button(
          entry.monitor_active ? "Pause alerts" : "Start watching",
          entry.monitor_active ? "no" : "yes",
        ),
        button("× Remove", "remove"),
      ],
    ],
  };
}
function details(entry: WatchlistEntry): string {
  return `${baseDetails(entry)}\nMust mention any of: ${entry.include_words ?? "anything"} · Block words: ${entry.exclude_words ?? "none"}`;
}
function baseDetails(entry: WatchlistEntry): string {
  if (entry.provider === "facebook")
    return `${entry.name}\nSearch: ${entry.query}\n${entry.monitor_active ? "New-listing alerts on" : "Research only; new-listing alerts off"}\nWithin ${entry.radius_km ?? 40} km of ${entry.location_name ?? "the search centre"} · max price: ${entry.max_price === null ? "any" : `£${entry.max_price}`}\nChecks every ${entry.interval_minutes} minutes when monitoring is on.`;
  return `${entry.name}\nSearch: ${entry.query}\n${entry.monitor_active ? "New-listing alerts on" : "Research only; new-listing alerts off"}\nCondition: ${entry.condition ?? "any"} · max price: ${entry.max_price === null ? "any" : `£${entry.max_price}`}\nDelivery: ${entry.free_shipping ? "free only" : "any price"} · ${entry.location ?? "any location"}\nChecks every ${entry.interval_minutes} minutes when monitoring is on.`;
}
export async function handleWatchlistInput(
  input: { text?: string; data?: string; updateId: number },
  chatId: string,
  store: WatchStore,
  repository: WatchlistRepository,
  send: TelegramSend,
): Promise<boolean> {
  const previous = store.setting("watchlistReply");
  if (previous) {
    const reply = replySchema.safeParse(JSON.parse(previous));
    if (reply.success && reply.data.updateId === input.updateId) {
      await send(reply.data.text, reply.data.options);
      return true;
    }
  }
  const reply = async (
    text: string,
    options: TelegramOptions = { keyboard: menu },
  ) => {
    store.setSetting(
      "watchlistReply",
      JSON.stringify({ updateId: input.updateId, text, options }),
    );
    await send(text, options);
  };
  const refresh = async () => {
    const entries = await repository.list(chatId);
    syncWatchlist(store, entries);
    return entries;
  };
  const facebook = repository.platform === "facebook";
  const text = input.text?.trim() ?? "";
  const lower = text.toLowerCase();
  if (["/cancel", "cancel"].includes(lower)) {
    store.setSetting("watchlistConversation", "");
    await reply("Cancelled. Send an item to research, or use the menu.");
    return true;
  }
  if (["/start", "/help"].includes(lower)) {
    await reply(
      facebook
        ? "Send an item title to check current asking prices on Facebook Marketplace nearby. Then choose whether to keep watching for new listings. Use Watch list to review, edit or remove items."
        : "Send an item title to research its sold prices. Then choose whether to keep watching it. Use Watch list to review, edit or remove items.",
    );
    return true;
  }
  if (["watch list", "review watch list", "/watchlist"].includes(lower)) {
    store.setSetting("watchlistConversation", "");
    const entries = await refresh();
    await reply(
      entries.length
        ? `Watch list (${entries.length}/10). Select an item to research, edit or remove:`
        : "Your watch list is empty. Send an item title to research it.",
      entries.length
        ? {
            buttons: entries.map((entry) => [
              {
                text: entry.name.slice(0, 64),
                data: watchButton(entry, "view"),
              },
            ]),
          }
        : { keyboard: menu },
    );
    return true;
  }
  if (["add item", "market research", "/add", "/market"].includes(lower)) {
    store.setSetting(
      "watchlistConversation",
      JSON.stringify({ field: "new", expires: Date.now() + 1800000 }),
    );
    await reply(
      facebook
        ? "Send the item title and any important details. I’ll save it and check current asking prices nearby. Ongoing alerts stay off until you choose Yes. /cancel to stop."
        : "Send the exact item title, model/edition and any important details. I’ll save it and queue completed-listing research. Ongoing alerts stay off until you choose Yes. /cancel to stop.",
    );
    return true;
  }
  if (input.data) {
    const match = /^w:([0-9a-f-]{36}):(\d+):([a-z_]+)$/.exec(input.data);
    if (!match) {
      await reply("This button is no longer available. Open Watch list.");
      return true;
    }
    const entries = await refresh();
    const entry = entries.find((row) => row.id === match[1]);
    if (!entry || entry.revision !== Number(match[2])) {
      await reply(
        "This watch changed or was removed. Open Watch list for its latest controls.",
      );
      return true;
    }
    const action = match[3]!;
    if (action === "view") {
      await reply(details(entry), actions(entry));
      return true;
    }
    if (action === "edit") {
      const button = (label: string, value: string) => ({
        text: label,
        data: watchButton(entry, value),
      });
      await reply(`Edit ${entry.name}:`, {
        buttons: facebook
          ? [
              [
                button("Search terms", "query"),
                button("Maximum price", "price"),
              ],
              [
                button("Radius", "radius"),
                button("Check interval", "interval"),
              ],
              [
                button("Must mention", "include"),
                button("Block words", "exclude"),
              ],
              [button("Back", "view")],
            ]
          : [
              [
                button("Search terms / edition", "query"),
                button("Maximum price", "price"),
              ],
              [
                button("Condition", "condition"),
                button("Delivery", "delivery"),
              ],
              [
                button("Buying format", "format"),
                button("Check interval", "interval"),
              ],
              [
                button("Must mention", "include"),
                button("Block words", "exclude"),
              ],
              [button("Back", "view")],
            ],
      });
      return true;
    }
    if (
      ["query", "price", "interval", "radius", "include", "exclude"].includes(
        action,
      )
    ) {
      store.setSetting(
        "watchlistConversation",
        JSON.stringify({
          field: action,
          id: entry.id,
          revision: entry.revision,
          expires: Date.now() + 1800000,
        }),
      );
      await reply(
        action === "query"
          ? "Send the updated search terms, including model or edition. /cancel to stop."
          : action === "price"
            ? "Send the maximum price in GBP, or Any to remove the limit. /cancel to stop."
            : action === "radius"
              ? "Send the search radius in kilometres (1 to 40). /cancel to stop."
              : action === "include"
                ? "Send words separated by commas. Alerts need at least one of them in the title or description, e.g. chesterfield, captain. Send Any to remove. /cancel to stop."
                : action === "exclude"
                  ? "Send words separated by commas. Listings mentioning any of them are skipped, e.g. PU, faux, kids. Send None to remove. /cancel to stop."
                  : "Send the check interval in minutes (1–1440). /cancel to stop.",
      );
      return true;
    }
    const button = (label: string, value: string) => ({
      text: label,
      data: watchButton(entry, value),
    });
    if (action === "format") {
      await reply("Choose buying format:", {
        buttons: [
          [button("Any", "fmt_any"), button("Buy it now", "fmt_buy_it_now")],
          [
            button("Auction", "fmt_auction"),
            button("Best offer", "fmt_best_offer"),
          ],
        ],
      });
      return true;
    }
    if (action === "condition") {
      await reply("Choose condition:", {
        buttons: [
          [
            button("Any", "cond_any"),
            button("New", "cond_new"),
            button("Used", "cond_used"),
          ],
          [
            button("Graded", "cond_graded"),
            button("Ungraded", "cond_ungraded"),
          ],
          [
            button("Refurbished", "cond_refurbished"),
            button("For parts", "cond_for_parts"),
          ],
        ],
      });
      return true;
    }
    if (action === "delivery") {
      await reply("Choose delivery preference:", {
        buttons: [
          [
            button("Free delivery only", "ship_yes"),
            button("Any delivery charge", "ship_no"),
          ],
          [
            button("UK domestic", "loc_domestic"),
            button("Worldwide", "loc_worldwide"),
            button("Any location", "loc_any"),
          ],
        ],
      });
      return true;
    }
    if (action === "remove") {
      await repository.remove(entry.id, chatId, entry.revision);
      await refresh();
      store.setSetting("watchlistConversation", "");
      await reply(
        `Removed ${entry.name}. Its searches and queued alerts have stopped.`,
      );
      return true;
    }
    let patch: WatchlistPatch;
    if (action === "yes")
      patch = facebook
        ? { monitor_active: true }
        : { monitor_active: true, monitor_sold: true };
    else if (action === "no")
      patch = { monitor_active: false, monitor_sold: false };
    else if (action === "research")
      patch = { research_requested_at: new Date().toISOString() };
    else if (action.startsWith("cond_")) {
      const condition = action.slice(5);
      const parsed = watchlistDraftSchema.shape.condition.safeParse(
        condition === "any" ? null : condition,
      );
      if (!parsed.success) {
        await reply("Choose a condition from Edit.");
        return true;
      }
      patch = {
        condition: parsed.data,
        research_requested_at: new Date().toISOString(),
      };
    } else if (action.startsWith("fmt_")) {
      const format = action.slice(4);
      const parsed = watchlistDraftSchema.shape.buying_format.safeParse(
        format === "any" ? null : format,
      );
      if (!parsed.success) {
        await reply("Choose a buying format from Edit.");
        return true;
      }
      patch = {
        buying_format: parsed.data,
        research_requested_at: new Date().toISOString(),
      };
    } else if (action === "ship_yes" || action === "ship_no")
      patch = {
        free_shipping: action === "ship_yes",
        research_requested_at: new Date().toISOString(),
      };
    else if (action.startsWith("loc_")) {
      const location = action.slice(4);
      const parsed = watchlistDraftSchema.shape.location.safeParse(
        location === "any" ? null : location,
      );
      if (!parsed.success) {
        await reply("Choose a location from Edit.");
        return true;
      }
      patch = {
        location: parsed.data,
        research_requested_at: new Date().toISOString(),
      };
    } else {
      await reply("Open Watch list to choose an action.");
      return true;
    }
    const updated = await repository.update(
      entry.id,
      chatId,
      entry.revision,
      patch,
    );
    await refresh();
    await reply(
      action === "research"
        ? `Fresh research queued for ${entry.name}. I’ll send the ${facebook ? "current asking prices" : "sold-price sample"} when the scan finishes.`
        : details(updated),
      actions(updated),
    );
    return true;
  }
  if (
    !text ||
    lower === "status" ||
    lower.startsWith("/status") ||
    /^\/market\s+(chairs|pokemon|charizard)\b/.test(lower)
  )
    return false;
  if (text.startsWith("/") && !/^\/(add|market)\s/.test(lower)) return false;
  const saved = store.setting("watchlistConversation");
  const parsedConversation = saved
    ? conversationSchema.safeParse(JSON.parse(saved))
    : undefined;
  const conversation =
    parsedConversation?.success && parsedConversation.data.expires > Date.now()
      ? parsedConversation.data
      : undefined;
  if (conversation && conversation.field !== "new") {
    const entries = await refresh();
    const entry = entries.find((row) => row.id === conversation.id);
    if (!entry || entry.revision !== conversation.revision) {
      store.setSetting("watchlistConversation", "");
      await reply(
        "This watch changed or was removed. Open Watch list and edit again.",
      );
      return true;
    }
    let patch: WatchlistPatch;
    if (conversation.field === "query") {
      if (text.length > 500) {
        await reply(
          "Use at most 500 characters for the search. /cancel to stop.",
        );
        return true;
      }
      patch = {
        query: text,
        name: text.slice(0, 100),
        market_profile: null,
        research_requested_at: new Date().toISOString(),
      };
    } else if (conversation.field === "price") {
      const value = lower === "any" ? null : Number(text.replace(/^£/, ""));
      if (
        value !== null &&
        (!Number.isFinite(value) || value < 0 || value > 1e10)
      ) {
        await reply(
          "Send a price such as 35 or 35.50, or Any. /cancel to stop.",
        );
        return true;
      }
      patch = {
        max_price: value,
        research_requested_at: new Date().toISOString(),
      };
    } else if (
      conversation.field === "include" ||
      conversation.field === "exclude"
    ) {
      const words = ["any", "none"].includes(lower)
        ? null
        : text
            .split(",")
            .map((word) => word.trim())
            .filter(Boolean)
            .join(", ");
      if (words !== null && (!words || words.length > 500)) {
        await reply(
          "Send up to 500 characters of comma-separated words, or Any. /cancel to stop.",
        );
        return true;
      }
      patch =
        conversation.field === "include"
          ? { include_words: words }
          : { exclude_words: words };
    } else if (conversation.field === "radius") {
      const value = Number(text.replace(/\s*km$/i, ""));
      if (!Number.isFinite(value) || value < 1 || value > 40) {
        await reply(
          "Facebook searches up to 40 km from the account location. Send 1 to 40. /cancel to stop.",
        );
        return true;
      }
      patch = { radius_km: value };
    } else {
      const value = Number(text);
      if (!Number.isInteger(value) || value < 1 || value > 1440) {
        await reply(
          "Use a whole number of minutes from 1 to 1440. /cancel to stop.",
        );
        return true;
      }
      patch = { interval_minutes: value };
    }
    const updated = await repository.update(
      entry.id,
      chatId,
      entry.revision,
      patch,
    );
    await refresh();
    store.setSetting("watchlistConversation", "");
    await reply(details(updated), actions(updated));
    return true;
  }
  const query = text.replace(/^\/(?:add|market)\s+/i, "").trim();
  if (!query || query.length > 500) {
    await reply(
      "Send an item title of 1–500 characters. Include model, condition or edition where it matters.",
    );
    return true;
  }
  const entries = await refresh();
  if (entries.length >= 10) {
    await reply(
      "The current server supports 10 watch-list items. Remove one before adding another.",
    );
    return true;
  }
  const createKey = `watchlistCreate:${input.updateId}`;
  const id = store.setting(createKey) ?? randomUUID();
  store.setSetting(createKey, id);
  const created = await repository.create(id, chatId, {
    name: query.slice(0, 100),
    query,
    ...(facebook ? { interval_minutes: 5 } : {}),
  });
  await refresh();
  store.setSetting("watchlistConversation", "");
  await reply(
    facebook
      ? `Saved ${created.name}. I’ll check current asking prices within ${created.radius_km ?? 40} km of ${created.location_name ?? "the search centre"} and send the lowest, median and highest. New-listing alerts are off until you choose Yes.`
      : `Saved ${created.name} for completed-listing research. I’ll send the observed floor, ceiling and sample size after the scan. New-listing alerts are off until you choose Yes.`,
    actions(created),
  );
  return true;
}
