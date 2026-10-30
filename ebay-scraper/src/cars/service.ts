import type { Browser } from "playwright-core";
import { telegramSender } from "../telegram.js";
import type { WatchStore } from "../watcher.js";
import { carCommands, carSender } from "./bot.js";
import {
  autoTraderFuels,
  parseAutoTrader,
  parseCatalogue,
  sameName,
  type Fuel,
} from "./listing.js";
import { marketReport, parseDepreciation } from "./market.js";
import { dailySlot, runCarScan, type CarSources } from "./monitor.js";
import { CarStore } from "./store.js";
import { createCarWatchlist, type CarWatch } from "./watchlist.js";

type Log = {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
  error(details: object, message: string): void;
};
type Option = { id: string; name: string };

const checkEvery = 10 * 60000;
const userAgent =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const belfast = "BT15GS";
const reason = (error: unknown) =>
  error instanceof Error ? error.message.split("\n")[0] : "unknown";

export function createCarService(options: {
  token: string;
  chatId: string;
  supabaseUrl: string;
  supabaseKey: string;
  settings: WatchStore;
  dataDir: string;
  browser: () => Browser;
  log: Log;
}) {
  const { settings, log } = options;
  const watchlist = createCarWatchlist(
    options.supabaseUrl,
    options.supabaseKey,
  );
  const text = telegramSender(options.token, options.chatId);
  const photos = carSender(options.token, options.chatId);
  const stores = new Map<string, CarStore>();
  const checkedAt = new Map<string, number>();
  const wanted = new Set<string>();
  let watches: CarWatch[] = [];
  let syncedAt = 0;

  // The original RAV4 data predates the watch list; keep using its file.
  const storeFor = (watch: CarWatch): CarStore => {
    const existing = stores.get(watch.id);
    if (existing) return existing;
    const legacy = settings.setting("carsLegacyWatch") === watch.id;
    const store = new CarStore(
      legacy
        ? `${options.dataDir}/cars.sqlite`
        : `${options.dataDir}/cars-${watch.id}.sqlite`,
    );
    if (legacy)
      for (const key of ["carsScanAt", "carsAlertsFrom"]) {
        const value = settings.setting(key);
        if (value !== undefined && store.setting(key) === undefined)
          store.setSetting(key, value);
      }
    stores.set(watch.id, store);
    return store;
  };
  const name = (watch: CarWatch) => `${watch.make} ${watch.model}`;

  const sync = async (): Promise<void> => {
    if (Date.now() - syncedAt < 60000) return;
    syncedAt = Date.now();
    const listed = await watchlist.list(options.chatId);
    if (!listed.length && !settings.setting("carsSeeded")) {
      const rav4 = await watchlist.create(crypto.randomUUID(), options.chatId, {
        make: "Toyota",
        model: "RAV4",
        fuel: null,
        max_age_years: 8,
      });
      settings.setSetting("carsSeeded", rav4.id);
      settings.setSetting("carsLegacyWatch", rav4.id);
      watches = [rav4];
      return;
    }
    watches = listed;
  };

  const page = async (url: string): Promise<string> => {
    const response = await fetch(url, {
      headers: { "user-agent": userAgent },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Used Cars NI ${response.status}`);
    return response.text();
  };
  const catalogue = async (make?: Option): Promise<Option[]> =>
    make
      ? parseCatalogue(
          await page(
            `https://www.usedcarsni.com/search_results.php?make=${make.id}&search_type=1`,
          ),
          "model",
        )
      : parseCatalogue(await page("https://www.usedcarsni.com/"), "make");
  const usedCarsNiIds = async (
    watch: CarWatch,
  ): Promise<{ make: string; model: string } | undefined> => {
    const make = (await catalogue()).find((m) => sameName(m.name, watch.make));
    if (!make) return undefined;
    const model = (await catalogue(make)).find((m) =>
      sameName(m.name, watch.model),
    );
    return model ? { make: make.id, model: model.id } : undefined;
  };

  // AutoTrader is behind Cloudflare: load the search in Chrome, then replay its
  // own listings request once per fuel type, which tags every car's fuel.
  const autoTrader: CarSources["autoTrader"] = async (watch, scope) => {
    const context = options.browser().contexts()[0];
    if (!context) throw new Error("No browser context");
    const tab = await context.newPage();
    await tab.route("**/*", (route) =>
      ["image", "media", "font"].includes(route.request().resourceType())
        ? route.abort()
        : route.continue(),
    );
    try {
      const first = tab.waitForResponse(
        (response) =>
          response.url().includes("SearchResultsListingsGridQuery") &&
          response.request().method() === "POST",
        { timeout: 60000 },
      );
      await tab.goto(
        `https://www.autotrader.co.uk/car-search?make=${encodeURIComponent(watch.make)}&model=${encodeURIComponent(watch.model)}&postcode=${belfast}&year-from=${new Date().getFullYear() - watch.max_age_years}&exclude-writeoff-categories=on&sort=most-recent${scope === "ni" ? "&radius=60" : ""}`,
        { waitUntil: "domcontentloaded", timeout: 60000 },
      );
      const request = (await first).request();
      const replay = {
        url: request.url(),
        headers: Object.fromEntries(
          Object.entries(request.headers()).filter(
            ([key]) => key.startsWith("x-") || key === "content-type",
          ),
        ),
        template: request.postData() ?? "[]",
      };
      const fetchPage = (fuel: string, n: number) =>
        tab.evaluate(
          async ({ url, headers, template, fuel, n }) => {
            const query = JSON.parse(template);
            query[0].variables.page = n;
            query[0].variables.filters = [
              ...query[0].variables.filters,
              { filter: "fuel_type", selected: [fuel] },
            ];
            const reply = await fetch(url, {
              method: "POST",
              headers,
              body: JSON.stringify(query),
            });
            if (!reply.ok)
              throw new Error(`AutoTrader page ${n}: ${reply.status}`);
            await new Promise((resolve) => setTimeout(resolve, 1200));
            return (await reply.json()) as unknown;
          },
          { ...replay, fuel, n },
        );
      const bodies: { fuel: Fuel; body: unknown }[] = [];
      for (const [value, fuel] of Object.entries(autoTraderFuels)) {
        if (watch.fuel !== null && fuel !== watch.fuel) continue;
        const body = await fetchPage(value, 1);
        bodies.push({ fuel, body });
        const pages =
          scope === "ni"
            ? 1
            : Math.min(
                300,
                parseAutoTrader(body, { model: watch.model, fuel }).pages,
              );
        for (let n = 2; n <= pages; n++)
          bodies.push({ fuel, body: await fetchPage(value, n) });
      }
      return bodies;
    } finally {
      await tab.close().catch(() => {});
    }
  };
  const ids = new Map<string, { make: string; model: string } | undefined>();
  const sources: CarSources = {
    autoTrader,
    usedCarsNi: async (watch, scope, n) => {
      if (!ids.has(watch.id)) ids.set(watch.id, await usedCarsNiIds(watch));
      const found = ids.get(watch.id);
      if (!found) return "<html></html>";
      return page(
        `https://www.usedcarsni.com/search_results.php?make=${found.make}&model=${found.model}&search_type=1&age_from=${new Date().getFullYear() - watch.max_age_years}&user_type=2%7C4&sortby=12%7C0&pagepc0=${n}${scope === "ni" ? `&distance_enabled=1&distance_postcode=${belfast}&distance_miles=60` : ""}`,
      );
    },
    usedCarsNiDetail: (url) =>
      new URL(url).hostname === "www.usedcarsni.com"
        ? page(url)
        : Promise.reject(new Error("Not a Used Cars NI link")),
  };

  // The Money Calculator is behind Cloudflare too; refresh its estimate daily.
  const refreshDepreciation = async (watch: CarWatch): Promise<void> => {
    const context = options.browser().contexts()[0];
    if (!context) return;
    const tab = await context.newPage();
    const slug = (part: string) =>
      encodeURIComponent(part.toUpperCase().replace(/\s+/g, "-"));
    try {
      await tab.goto(
        `https://www.themoneycalculator.com/vehicle-finance/calculators/car-depreciation-by-make-and-model/${slug(watch.make)}/${slug(watch.model)}/`,
        { waitUntil: "domcontentloaded", timeout: 60000 },
      );
      await tab.waitForTimeout(10000);
      const loss = parseDepreciation(
        await tab.evaluate(() => document.body.innerText),
      );
      if (loss !== undefined)
        storeFor(watch).setSetting("tmcLoss", String(loss));
    } finally {
      await tab.close().catch(() => {});
    }
  };

  const report = (watch: CarWatch): string[] => {
    const store = storeFor(watch);
    const scanAt = store.setting("carsScanAt");
    const loss = Number(store.setting("tmcLoss"));
    return marketReport(
      store.observations(scanAt ? Number(scanAt) : undefined, Date.now()),
      new Date(),
      {
        title: name(watch),
        maxAge: watch.max_age_years,
        ...(loss > 0 ? { benchmark: { threeYearLoss: loss } } : {}),
      },
    );
  };

  const scan = async (
    watch: CarWatch,
    full: boolean,
    announce: boolean,
  ): Promise<void> => {
    const store = storeFor(watch);
    const firstScan = !store.setting("carsScanAt");
    const result = await runCarScan({
      full,
      watch,
      sources,
      store,
      now: Date.now,
      alert: async (car, caption) => {
        try {
          await photos(caption, car.images);
        } catch {
          await photos(caption, []).catch(() => {
            log.warn(
              { event: "car_alert_failed", car: car.id },
              "Car alert not delivered",
            );
          });
        }
      },
    });
    log.info(
      { event: "car_scan", watch: name(watch), full, ...result },
      "Car scan finished",
    );
    if (!full) return;
    await refreshDepreciation(watch).catch(() => {
      log.warn(
        { event: "depreciation_refresh_failed", watch: name(watch) },
        "Money Calculator estimate not refreshed",
      );
    });
    if (firstScan)
      await text(
        `${name(watch)} monitoring is live. Every car currently for sale was recorded as a baseline; from now on you'll get an alert, with photos, for each new ${watch.fuel ? `${watch.fuel} ` : ""}${name(watch)} under ${watch.max_age_years} years old from a dealer within 60 miles of Belfast on Used Cars NI or AutoTrader. Write-offs, damaged cars, non-runners and private sellers are excluded.`,
      );
    if (announce || firstScan)
      for (const part of report(watch)) await text(part, { html: true });
  };

  return {
    async commands(): Promise<void> {
      await sync().catch((error: unknown) => {
        log.warn(
          { event: "car_watchlist_sync_failed", reason: reason(error) },
          "Car list sync will retry",
        );
      });
      await carCommands({
        token: options.token,
        chatId: options.chatId,
        store: settings,
        watchlist,
        send: text,
        catalogue,
        report,
        refresh: (watch) => {
          syncedAt = 0;
          for (const w of watch ? [watch] : watches) wanted.add(w.id);
          if (watch && !watches.some((w) => w.id === watch.id))
            watches = [...watches, watch];
        },
      });
    },
    // One job at a time: a full scan when one is due, else a Belfast check.
    nextJob(): (() => Promise<void>) | undefined {
      const slot = dailySlot(new Date());
      for (const watch of watches) {
        const store = storeFor(watch);
        const due =
          wanted.has(watch.id) ||
          !store.setting("carsScanAt") ||
          (slot !== undefined && !store.setting(`daily:${slot}`));
        if (!due) continue;
        const announce = wanted.delete(watch.id);
        if (slot) store.setSetting(`daily:${slot}`, String(Date.now()));
        checkedAt.set(watch.id, Date.now());
        return () =>
          scan(watch, true, announce).catch((error: unknown) => {
            log.error(
              {
                event: "car_scan_failed",
                watch: name(watch),
                reason: reason(error),
              },
              "Full car scan failed",
            );
          });
      }
      const next = watches.find(
        (watch) => Date.now() - (checkedAt.get(watch.id) ?? 0) >= checkEvery,
      );
      if (!next) return undefined;
      checkedAt.set(next.id, Date.now());
      return () =>
        scan(next, false, false).catch((error: unknown) => {
          log.warn(
            {
              event: "car_check_failed",
              watch: name(next),
              reason: reason(error),
            },
            "New car check failed; it will retry",
          );
        });
    },
    close(): void {
      for (const store of stores.values()) store.close();
    },
  };
}
