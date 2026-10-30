import type { WatchStore } from "./watcher.js";
import { watchSchema, type WatchInput } from "./watch-config.js";
import { marketSummary, saleObservation, researchText } from "./market.js";
import type { Listing } from "./contract.js";
import {
  watchlistRowSchema,
  type WatchlistEntry,
} from "./supabase-watchlist.js";

export function watchButton(entry: WatchlistEntry, action: string): string {
  return `w:${entry.id}:${entry.revision}:${action}`;
}
function definitions(entry: WatchlistEntry): WatchInput[] {
  const common = {
    name: entry.name,
    once: false,
    query: entry.query,
    domain: entry.domain,
    watchlistId: entry.id,
    intervalMinutes: entry.interval_minutes,
    ...(entry.market_profile ? { marketProfile: entry.market_profile } : {}),
    ...(entry.condition ? { condition: entry.condition } : {}),
    ...(entry.buying_format ? { buyingFormat: entry.buying_format } : {}),
    ...(entry.min_price !== null ? { minPrice: entry.min_price } : {}),
    ...(entry.max_price !== null ? { maxPrice: entry.max_price } : {}),
    ...(entry.location ? { location: entry.location } : {}),
    ...(entry.language ? { language: entry.language } : {}),
    freeShipping: entry.free_shipping,
    ...(entry.provider === "facebook"
      ? {
          provider: entry.provider,
          ...(entry.latitude !== undefined ? { latitude: entry.latitude } : {}),
          ...(entry.longitude !== undefined
            ? { longitude: entry.longitude }
            : {}),
          ...(entry.radius_km !== undefined
            ? { radiusKm: entry.radius_km }
            : {}),
          ...(entry.location_name ? { locationName: entry.location_name } : {}),
        }
      : {}),
  };
  const result: WatchInput[] = [];
  if (entry.monitor_active)
    result.push(
      watchSchema.parse({
        ...common,
        name: `${entry.name.slice(0, 90)} — active`,
        mode: "active",
        notifyNew: true,
      }),
    );
  if (entry.provider === "facebook") {
    if (entry.research_requested_at)
      result.push(
        watchSchema.parse({
          ...common,
          name: `${entry.name.slice(0, 90)} — prices`,
          mode: "active",
          notifyNew: false,
          once: true,
          researchRequest: entry.research_requested_at,
        }),
      );
    return result;
  }
  if (entry.monitor_sold || entry.research_requested_at)
    result.push(
      watchSchema.parse({
        ...common,
        name: `${entry.name.slice(0, 90)} — sold`,
        mode: "sold",
        notifyNew: false,
        once: !entry.monitor_sold,
        ...(entry.research_requested_at
          ? { researchRequest: entry.research_requested_at }
          : {}),
      }),
    );
  return result;
}
function askingPriceText(
  entry: WatchlistEntry,
  listings: readonly Listing[],
): string {
  const prices = listings
    .flatMap((row) => (row.price ? [row.price.value] : []))
    .sort((a, b) => a - b);
  const money = (value: number) => `£${value.toFixed(2)}`;
  const middle = Math.floor(prices.length / 2);
  const median =
    prices.length % 2
      ? prices[middle]!
      : (prices[middle - 1]! + prices[middle]!) / 2;
  return `${entry.name}\n${listings.length} current listings within ${entry.radius_km ?? 40} km of ${entry.location_name ?? "the search centre"}\n${prices.length ? `Lowest ${money(prices[0]!)} · median ${money(median)} · highest ${money(prices.at(-1)!)}` : "No disclosed asking prices"}\nFacebook Marketplace asking prices, not completed sales. Keep watching for new listings?`;
}
function sameDefinition(job: WatchInput, definition: WatchInput): boolean {
  return (
    JSON.stringify(watchSchema.parse(job)) ===
    JSON.stringify(watchSchema.parse(definition))
  );
}
function sameSearch(a: WatchInput, b: WatchInput): boolean {
  const identity = (input: WatchInput) => {
    const {
      name: _name,
      intervalMinutes: _interval,
      once: _once,
      notifyNew: _notify,
      ...search
    } = watchSchema.parse(input);
    return JSON.stringify(search);
  };
  return identity(a) === identity(b);
}
export function syncWatchlist(
  store: WatchStore,
  input: readonly WatchlistEntry[],
): void {
  const entries = input
    .map((row) => watchlistRowSchema.parse(row))
    .filter((row) => !row.deleted_at);
  if (entries.length > 10)
    throw new Error("Maximum 10 watch-list items on the current server");
  const wanted = entries.flatMap(definitions);
  if (
    wanted.length + store.list().filter((job) => !job.watchlistId).length >
    20
  )
    throw new Error("Search capacity exceeded; no watch-list changes applied");
  // Decide the complete replacement before mutating; invalid remote data must
  // never be mistaken for an empty watch list.
  for (const job of store.list()) {
    if (!job.watchlistId) continue;
    const {
      id: _id,
      baselined: _base,
      nextRun: _next,
      lastSuccess: _success,
      lastError: _error,
      resultCount: _count,
      ...config
    } = job;
    const definition = wanted.find((def) => sameSearch(config, def));
    if (!definition) store.remove(job.id);
    else if (!sameDefinition(config, definition))
      store.configure(job.id, definition);
  }
  for (const definition of wanted) {
    if (
      !store.list().some((job) => {
        const {
          id: _id,
          baselined: _base,
          nextRun: _next,
          lastSuccess: _success,
          lastError: _error,
          resultCount: _count,
          ...config
        } = job;
        return sameDefinition(config, definition);
      })
    )
      store.create(definition);
  }
  store.setSetting("watchlistSnapshot", JSON.stringify(entries));
}
export function publishResearch(
  store: WatchStore,
  entries: readonly WatchlistEntry[],
  now: number,
): void {
  for (const entry of entries) {
    if (!entry.research_requested_at || entry.deleted_at) continue;
    const key = `researchPublished:${entry.id}:${entry.research_requested_at}`;
    if (store.setting(key)) continue;
    const job = store
      .list()
      .find(
        (w) =>
          w.watchlistId === entry.id &&
          w.mode === (entry.provider === "facebook" ? "active" : "sold") &&
          w.researchRequest === entry.research_requested_at &&
          w.baselined,
      );
    if (!job) continue;
    if (entry.provider === "facebook") {
      store.enqueue(
        job.id,
        `research:${entry.research_requested_at}`,
        askingPriceText(entry, store.listings(job.id)),
        {
          buttons: [
            [
              { text: "Yes, keep watching", data: watchButton(entry, "yes") },
              { text: "No, research only", data: watchButton(entry, "no") },
            ],
          ],
        },
      );
      store.setSetting(key, "queued");
      continue;
    }
    const observations = store.listings(job.id).flatMap((row) => {
      const observation = saleObservation(row, now);
      return observation ? [observation] : [];
    });
    const stats = marketSummary(observations, 90, now);
    store.enqueue(
      job.id,
      `research:${entry.research_requested_at}`,
      researchText(entry.name, stats) +
        "\nSearch-matched GBP sales; verify edition, condition and comparability. Keep watching for new listings?",
      {
        buttons: [
          [
            { text: "Yes, keep watching", data: watchButton(entry, "yes") },
            { text: "No, research only", data: watchButton(entry, "no") },
          ],
        ],
      },
    );
    store.setSetting(key, "queued");
  }
}

export async function migrateExistingWatches(
  store: WatchStore,
  repository: import("./supabase-watchlist.js").WatchlistRepository,
  chatId: string,
): Promise<void> {
  if (store.setting("watchlistMigrated")) return;
  const { randomUUID } = await import("node:crypto");
  const existing = await repository.list(chatId);
  const legacy = store
    .list()
    .filter((job) => !job.watchlistId && job.marketProfile);
  for (const profile of ["chairs", "charizard_psa9_base"] as const) {
    const jobs = legacy.filter((job) => job.marketProfile === profile);
    if (!jobs.length) continue;
    const source = jobs[0]!;
    const key = `watchlistMigration:${profile}`;
    const id = store.setting(key) ?? randomUUID();
    store.setSetting(key, id);
    const entry =
      existing.find((row) => row.id === id) ??
      (await repository.create(id, chatId, {
        name: source.name.replace(/ — (active|sold)$/, ""),
        query: source.query,
        domain: source.domain,
        interval_minutes: source.intervalMinutes,
        market_profile: profile,
        monitor_active: jobs.some((job) => job.mode === "active"),
        monitor_sold: jobs.some((job) => job.mode === "sold"),
        ...(source.maxPrice !== undefined
          ? { max_price: source.maxPrice }
          : {}),
      }));
    for (const job of jobs)
      store.link(job.id, entry.id, entry.research_requested_at ?? undefined);
    if (entry.research_requested_at)
      store.setSetting(
        `researchPublished:${entry.id}:${entry.research_requested_at}`,
        "existing research retained",
      );
  }
  store.setSetting("watchlistMigrated", "1");
}
