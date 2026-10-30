import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  dailySlot,
  runCarScan,
  type CarSources,
} from "../../src/cars/monitor.js";
import { CarStore } from "../../src/cars/store.js";
import type { CarWatch } from "../../src/cars/watchlist.js";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/cars/${name}`, import.meta.url), "utf8");
const autoTrader = JSON.parse(fixture("autotrader.json"));
const usedCarsNi = fixture("usedcarsni.html");
const lastPage = usedCarsNi.replace(/>Next</, "><");
const empty = "<html></html>";
const firstCarOnly = () => {
  const body = structuredClone(autoTrader);
  body[0].data.searchResults.listings.splice(2);
  return body;
};
const description = (text: string) =>
  `<script type="application/ld+json">{"@type":"Car","description":"${text}"}</script><a href="/auto_salvage_search.php">Salvage</a>`;

const rav4: CarWatch = {
  id: "d76774de-6fea-4d07-8adf-227d57e03da6",
  telegram_chat_id: "123",
  make: "Toyota",
  model: "RAV4",
  fuel: null,
  max_age_years: 20,
  alerts_active: true,
  created_at: "2026-10-28T20:00:00Z",
  deleted_at: null,
};
type Pages = {
  uk?: unknown[];
  near?: unknown[];
  all?: string[];
  nearby?: string;
  details?: Record<string, string>;
};
const setup = () => {
  const store = new CarStore(":memory:");
  const alerts: string[] = [];
  const visited: string[] = [];
  const sources = (pages: Pages = {}): CarSources => ({
    autoTrader: async (_watch, scope) => {
      visited.push(`autotrader:${scope}`);
      return (
        scope === "uk"
          ? (pages.uk ?? [autoTrader])
          : (pages.near ?? [firstCarOnly()])
      ).map((body) => ({ fuel: "Hybrid" as const, body }));
    },
    usedCarsNi: async (_watch, scope, page) => {
      visited.push(`usedcarsni:${scope}:${page}`);
      return scope === "all"
        ? ((pages.all ?? [usedCarsNi, lastPage])[page - 1] ?? lastPage)
        : (pages.nearby ?? empty);
    },
    usedCarsNiDetail: async (url) => {
      const id = url.split("-").at(-1) ?? "";
      visited.push(`detail:${id}`);
      const html = pages.details?.[id];
      if (html === undefined) return description("Full service history");
      if (html === "fail") throw new Error("timeout");
      return html;
    },
  });
  const run = (
    full: boolean,
    s: CarSources,
    now = Date.now(),
    watch: CarWatch = rav4,
  ) =>
    runCarScan({
      full,
      watch,
      sources: s,
      store,
      now: () => now,
      alert: async (car, text) => void alerts.push(`${car.id} ${text}`),
    });
  const ids = () => alerts.map((a) => a.split(" ")[0]).sort();
  return { store, alerts, visited, sources, run, ids };
};
const alertsStarted = async (s: ReturnType<typeof setup>) => {
  await s.run(true, s.sources({ uk: [firstCarOnly()], all: [empty] }));
  await s.run(false, s.sources());
  s.visited.length = 0;
};

it("records the whole market on the first full scan without alerting", async () => {
  const { alerts, visited, sources, run, store } = setup();
  expect(await run(false, sources())).toEqual({ found: 0, alerted: 0 });
  expect(visited).toEqual([]);
  expect(await run(true, sources())).toEqual({ found: 9, alerted: 0 });
  expect(visited.slice(0, 3)).toEqual([
    "autotrader:uk",
    "usedcarsni:all:1",
    "usedcarsni:all:2",
  ]);
  expect(visited.slice(3).sort()).toEqual([
    "detail:410208768",
    "detail:410590759",
    "detail:413818101",
  ]);
  expect(alerts).toEqual([]);
  expect(store.setting("carsScanAt")).toBeDefined();
});

it("treats the cars near Belfast on the first check as already known", async () => {
  const s = setup();
  await s.run(true, s.sources());
  expect(
    await s.run(false, s.sources({ near: [autoTrader], nearby: usedCarsNi })),
  ).toEqual({ found: 9, alerted: 0 });
  expect(s.visited.slice(-2)).toEqual(["autotrader:ni", "usedcarsni:ni:1"]);
  expect(s.alerts).toEqual([]);
});

it("alerts each new car near Belfast once, with its listing date", async () => {
  const s = setup();
  await alertsStarted(s);
  const near = s.sources({ near: [autoTrader], nearby: usedCarsNi });
  expect(await s.run(false, near)).toEqual({ found: 9, alerted: 8 });
  expect(s.ids()).toEqual(
    [
      "202610287408346",
      "202610287407356",
      "202610287405467",
      "202610287400352",
      "202610287399081",
      "410208768",
      "410590759",
      "413818101",
    ].sort(),
  );
  expect(s.alerts.find((a) => a.startsWith("202610287408346"))).toContain(
    "Listed 28 Oct 2026",
  );
  await s.run(false, near);
  expect(s.alerts).toHaveLength(8);
});

it("still alerts a new car the morning market scan happened to find first", async () => {
  const s = setup();
  await alertsStarted(s);
  await s.run(true, s.sources());
  await s.run(false, s.sources({ near: [autoTrader] }));
  expect(s.ids()).toHaveLength(5);
  expect(s.ids()).not.toContain("202608275494300");
});

it("never alerts a car whose advert mentions a write-off or structural damage", async () => {
  const s = setup();
  await alertsStarted(s);
  const near = (details: Record<string, string>) =>
    s.sources({ near: [firstCarOnly()], nearby: usedCarsNi, details });
  await s.run(
    false,
    near({
      "413818101": description("Cat S repaired, drives perfect"),
      "410590759": "fail",
    }),
  );
  expect(s.ids()).toEqual(["410208768"]);
  await s.run(false, near({}));
  expect(s.ids()).toEqual(["410208768", "410590759"]);
});

it("keeps the previous market data when a full scan is blocked", async () => {
  const { run, sources, store } = setup();
  await run(true, sources(), 1000);
  await expect(run(true, sources({ uk: [] }), 2000)).rejects.toThrow(
    /AutoTrader/,
  );
  expect(store.setting("carsScanAt")).toBe("1000");
});

it("counts cars that disappear between full scans as gone", async () => {
  const { store, run, sources } = setup();
  await run(true, sources(), 1000);
  const fewer = structuredClone(autoTrader);
  fewer[0].data.searchResults.listings.splice(1, 1);
  await run(true, sources({ uk: [fewer] }), 2000);
  const observations = store.observations(2000, 3000);
  expect(observations.filter((o) => o.gone).map((o) => o.car.id)).toEqual([
    "202608275494300",
  ]);
  expect(observations.find((o) => o.gone)?.at.getTime()).toBe(1000);
});

it("rescans the whole market once each morning, UK time", () => {
  expect(dailySlot(new Date("2026-10-28T04:59:00Z"))).toBeUndefined();
  expect(dailySlot(new Date("2026-10-28T06:00:00Z"))).toBe("2026-10-28");
  expect(dailySlot(new Date("2026-07-01T04:30:00Z"))).toBeUndefined();
  expect(dailySlot(new Date("2026-07-01T05:30:00Z"))).toBe("2026-07-01");
});

it("keeps cars whose seller description reveals a write-off out of the market data", async () => {
  const { store, run, sources } = setup();
  const details = {
    "413818101": description("Category N, repaired, drives perfect"),
    "410590759": "fail",
  };
  await run(true, sources({ details }), 1000);
  const ids = () =>
    store
      .observations(1000, 2000)
      .filter((o) => o.car.source === "Used Cars NI")
      .map((o) => o.car.id);
  expect(ids()).toEqual(["410208768"]);
  await run(
    true,
    sources({ details: { ...details, "410590759": description("One owner") } }),
    1500,
  );
  expect(ids().sort()).toEqual(["410208768", "410590759"]);
});

it("alerts only cars within the watch's age and fuel, and stays quiet when paused", async () => {
  const s = setup();
  await alertsStarted(s);
  const near = s.sources({ near: [autoTrader], nearby: usedCarsNi });
  await s.run(false, near, Date.now(), { ...rav4, max_age_years: 5 });
  expect(s.ids()).toEqual(["202610287407356", "202610287408346"]);
  const quiet = setup();
  await alertsStarted(quiet);
  await quiet.run(false, near, Date.now(), { ...rav4, alerts_active: false });
  await quiet.run(false, near);
  expect(quiet.alerts).toEqual([]);
  const diesel = setup();
  await alertsStarted(diesel);
  await diesel.run(
    false,
    diesel.sources({ near: [autoTrader], nearby: usedCarsNi }),
    Date.now(),
    { ...rav4, fuel: "Diesel" },
  );
  expect(diesel.ids()).toEqual(["413818101"]);
});
