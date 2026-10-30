import {
  parseAutoTrader,
  parseUsedCarsNi,
  writtenOff,
  type Car,
  type Fuel,
} from "./listing.js";
import { alertText, band, valuation } from "./market.js";
import type { CarStore } from "./store.js";
import type { CarWatch } from "./watchlist.js";

export type CarSources = {
  autoTrader: (
    watch: CarWatch,
    scope: "uk" | "ni",
  ) => Promise<{ fuel: Fuel; body: unknown }[]>;
  usedCarsNi: (
    watch: CarWatch,
    scope: "all" | "ni",
    page: number,
  ) => Promise<string>;
  usedCarsNiDetail: (url: string) => Promise<string>;
};

const unique = (cars: Car[]): Car[] => [
  ...new Map(cars.map((car) => [`${car.source}:${car.id}`, car])).values(),
];

// Seller descriptions often disclose a write-off that the title leaves out.
const advertText = (html: string): string =>
  [
    ...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ),
  ]
    .map((match) => match[1])
    .join(" ");

export async function runCarScan(options: {
  full: boolean;
  watch: CarWatch;
  sources: CarSources;
  store: CarStore;
  now: () => number;
  alert: (car: Car, text: string) => Promise<void>;
}): Promise<{ found: number; alerted: number }> {
  if (!options.full && options.store.setting("carsScanAt") === undefined)
    return { found: 0, alerted: 0 };
  const started = options.now();
  const scope = options.full ? "uk" : "ni";
  const { watch } = options;
  const autoTrader = (await options.sources.autoTrader(watch, scope)).flatMap(
    ({ fuel, body }) =>
      parseAutoTrader(body, { model: watch.model, fuel }).cars,
  );
  if (options.full && !autoTrader.length)
    throw new Error("AutoTrader returned no cars");
  const usedCarsNi: Car[] = [];
  for (let page = 1; page <= (options.full ? 20 : 1); page++) {
    const { cars, more } = parseUsedCarsNi(
      await options.sources.usedCarsNi(
        watch,
        options.full ? "all" : "ni",
        page,
      ),
    );
    usedCarsNi.push(...cars);
    if (!more) break;
  }
  const cars = unique([...autoTrader, ...usedCarsNi]).filter(
    (car) => watch.fuel === null || car.fuel === watch.fuel,
  );
  options.store.record(cars, started);
  for (const car of options.store.unchecked(options.full ? 200 : 20)) {
    const details = await options.sources
      .usedCarsNiDetail(car.url)
      .catch(() => undefined);
    if (details !== undefined)
      options.store.checked(car, writtenOff(advertText(details)));
  }
  if (options.full) {
    options.store.setSetting("carsScanAt", String(started));
    return { found: cars.length, alerted: 0 };
  }
  const since = options.store.setting("carsAlertsFrom");
  if (since === undefined) {
    options.store.setSetting("carsAlertsFrom", String(started));
    options.store.markAlerted(cars);
    return { found: cars.length, alerted: 0 };
  }
  const now = new Date(options.now());
  const observations = options.store.observations(
    Number(options.store.setting("carsScanAt")),
    now.getTime(),
  );
  let alerted = 0;
  for (const car of options.store.unalerted(cars, Number(since))) {
    if (!watch.alerts_active || !band(car, now, watch.max_age_years)) {
      options.store.markAlerted([car]);
      continue;
    }
    await options.alert(
      car,
      alertText(car, {
        now,
        firstSeen: options.store.firstSeen(car) ?? started,
        value: valuation(car, observations, now, watch.max_age_years),
      }),
    );
    options.store.markAlerted([car]);
    alerted++;
  }
  return { found: cars.length, alerted };
}

export function dailySlot(now: Date): string | undefined {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return Number(parts["hour"]) >= 6
    ? `${parts["year"]}-${parts["month"]}-${parts["day"]}`
    : undefined;
}
