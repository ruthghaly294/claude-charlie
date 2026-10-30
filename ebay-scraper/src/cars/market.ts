import { fuels, type Car } from "./listing.js";

export type Observation = {
  car: Car;
  at: Date;
  gone: boolean;
  listed?: number | null;
};
export type Valuation = {
  median: number;
  count: number;
  age: number;
  miles: number;
};

const defaultMaxAge = 8;
const pounds = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const londonDate = (time: number, withTime = false) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime
      ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
      : {}),
  }).format(time);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

export function band(
  car: Car,
  at: Date,
  maxAge = defaultMaxAge,
): { age: number; miles: number } | undefined {
  const [year, month] = car.registered.split("-").map(Number);
  const months =
    at.getUTCFullYear() * 12 + at.getUTCMonth() - (year! * 12 + month! - 1);
  const age = Math.floor(months / 12);
  if (months < 0 || age >= maxAge) return undefined;
  return { age, miles: Math.floor(car.mileage / 10000) };
}

const ageLabel = (age: number) => `${age}–${age + 1} years old`;
const milesLabel = (miles: number) => `${miles * 10}-${miles * 10 + 10}k`;
const cell = (prices: number[]) =>
  prices.length ? `${pounds(median(prices))} ×${prices.length}` : "–";

export const parseDepreciation = (text: string): number | undefined => {
  const match = text.match(
    /depreciate\s+(\d+(?:\.\d+)?)\s+percent\s+in\s+the\s+first\s+three\s+years/i,
  );
  return match ? Number(match[1]) : undefined;
};

const fuelLabel = (fuel: Car["fuel"]) => fuel ?? "Fuel not known";
const sameBand = (
  a: { age: number; miles: number; car: Car },
  b: { age: number; miles: number; car: Car },
) => a.age === b.age && a.miles === b.miles && a.car.fuel === b.car.fuel;

const depreciation = (
  banded: { age: number; car: Car }[],
  options: {
    title: string;
    maxAge: number;
    fuel: string;
    benchmark: { threeYearLoss: number } | undefined;
  },
): string[] => {
  const { benchmark, maxAge } = options;
  const medians = Array.from({ length: maxAge }, (_, age) => {
    const prices = banded.filter((o) => o.age === age).map((o) => o.car.price);
    return prices.length ? median(prices) : undefined;
  });
  const base = medians[0];
  if (base === undefined) return [];
  const share = (price: number) => Math.round((100 * price) / base);
  const lines = medians.flatMap((price, age) =>
    price === undefined
      ? []
      : [
          `${`${age}–${age + 1} years`.padEnd(11)}${pounds(price).padEnd(9)}${share(price)}%`,
        ],
  );
  const three = medians[3];
  const comparison =
    benchmark && three !== undefined
      ? `\nThe Money Calculator estimates ${options.title}s lose ${benchmark.threeYearLoss}% in their first 3 years; our 3–4 year old cars are ${100 - share(three)}% below 0–1 year old ones.`
      : "";
  return [
    `<b>Depreciation, ${options.fuel}</b>: median price at each age (all mileages, for sale and gone) as a share of 0–1 year old cars\n<pre>${"Age".padEnd(11)}${"Median".padEnd(9)}Value\n${lines.join("\n")}</pre>${comparison}`,
  ];
};

const day = 86400000;
const saleSpeeds = [
  { label: "0–7 days", max: 7 },
  { label: "8–28 days", max: 28 },
  { label: "29–56 days", max: 56 },
  { label: "57+ days", max: Infinity },
];
const percent = (ratio: number) =>
  `${ratio > 0 ? "+" : ""}${Math.round(ratio * 100)}%`;

// A car that sells quickly was usually priced below similar cars.
const timeToSell = (
  banded: (Observation & { age: number; miles: number })[],
): string[] => {
  const sold = banded.flatMap((o) =>
    o.gone && typeof o.listed === "number"
      ? [{ ...o, days: Math.max(0, (o.at.getTime() - o.listed) / day) }]
      : [],
  );
  if (!sold.length)
    return [
      "<b>Time to sell</b>: no sold cars with a known listing date yet. This fills in as tracked cars sell.",
    ];
  const versus = (o: (typeof sold)[number]) => {
    const others = banded
      .filter((b) => b !== o && sameBand(b, o))
      .map((b) => b.car.price);
    return others.length >= 3 ? o.car.price / median(others) - 1 : undefined;
  };
  const lines = saleSpeeds.flatMap((speed, i) => {
    const group = sold.filter(
      (o) => o.days <= speed.max && o.days > (saleSpeeds[i - 1]?.max ?? -1),
    );
    if (!group.length) return [];
    const ratios = group.flatMap((o) => {
      const r = versus(o);
      return r === undefined ? [] : [r];
    });
    return [
      `${speed.label.padEnd(12)}${String(group.length).padEnd(6)}${ratios.length ? percent(median(ratios)) : "–"}`,
    ];
  });
  return [
    `<b>Time to sell</b>: listing date to removal, for cars that have gone\n<pre>${"Sold within".padEnd(12)}${"Cars".padEnd(6)}Price vs similar\n${lines.join("\n")}</pre>\nMedian time to sell: ${Math.round(median(sold.map((o) => o.days)))} days (${sold.length} cars). Cars already for sale when tracking began on Used Cars NI have no known listing date and are left out.`,
  ];
};

export type ResaleScenario = {
  fuel: NonNullable<Car["fuel"]>;
  buyAge: number;
  buyMiles: number;
  sellAge: number;
  sellMiles: number;
  years: number;
  pay: number;
  get: number;
  perYear: number;
  perTenThousand: number;
  perMile: number;
  beyondData: boolean;
  cars: number;
};

const milesPerYear = 10000;
const sellAt = 100000;
const buyPoints = [
  [5, 60000],
  [5, 70000],
  [6, 70000],
  [6, 80000],
  [7, 80000],
  [7, 90000],
] as const;
const ageYears = (car: Car, at: Date) => {
  const [year, month] = car.registered.split("-").map(Number);
  return (
    (at.getUTCFullYear() * 12 + at.getUTCMonth() - (year! * 12 + month! - 1)) /
    12
  );
};
// Least squares for ln(price) = a + b·age + c·(miles/10k); depreciation is
// roughly a constant percentage per year and per mile.
const fitPrices = (points: { age: number; miles: number; price: number }[]) => {
  const rows = points.map((p) => [1, p.age, p.miles / 10000]);
  const y = points.map((p) => Math.log(p.price));
  const xtx = [0, 1, 2].map((i) =>
    [0, 1, 2].map((j) => rows.reduce((sum, r) => sum + r[i]! * r[j]!, 0)),
  );
  const xty = [0, 1, 2].map((i) =>
    rows.reduce((sum, r, k) => sum + r[i]! * y[k]!, 0),
  );
  const det = (m: number[][]) =>
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
    m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
    m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  const d = det(xtx);
  if (Math.abs(d) < 1e-9) return undefined;
  const [a, b, c] = [0, 1, 2].map(
    (col) =>
      det(xtx.map((row, i) => row.map((v, j) => (j === col ? xty[i]! : v)))) /
      d,
  );
  return (age: number, miles: number) =>
    Math.exp(a! + b! * age + (c! * miles) / 10000);
};

export function resaleScenarios(observations: Observation[]): ResaleScenario[] {
  return fuels.flatMap((fuel) => {
    const points = observations
      .filter((o) => o.car.fuel === fuel)
      .map((o) => ({
        age: ageYears(o.car, o.at),
        miles: o.car.mileage,
        price: o.car.price,
      }))
      .filter((p) => p.age >= 0 && p.price > 0);
    if (points.length < 30) return [];
    const model = fitPrices(points);
    if (!model || model(1, 50000) <= model(2, 60000)) return [];
    const oldest = Math.max(...points.map((p) => p.age));
    return buyPoints.map(([buyAge, buyMiles]) => {
      const years = (sellAt - buyMiles) / milesPerYear;
      const pay = model(buyAge, buyMiles);
      const get = model(buyAge + years, sellAt);
      const loss = pay - get;
      return {
        fuel,
        buyAge,
        buyMiles,
        sellAge: buyAge + years,
        sellMiles: sellAt,
        years,
        pay,
        get,
        perYear: loss / years,
        perTenThousand: loss / ((sellAt - buyMiles) / 10000),
        perMile: loss / (sellAt - buyMiles),
        beyondData: buyAge + years > oldest,
        cars: points.length,
      };
    });
  });
}

const resale = (observations: Observation[]): string[] => {
  const scenarios = resaleScenarios(observations);
  return fuels.flatMap((fuel) => {
    const ofFuel = scenarios.filter((s) => s.fuel === fuel);
    if (!ofFuel.length) return [];
    const lines = ofFuel.map(
      (s) =>
        `Buy at ${s.buyAge} years, ${s.buyMiles / 1000}k → sell at ${s.sellAge} years, ${s.sellMiles / 1000}k${s.beyondData ? "*" : ""}: pay ${pounds(s.pay)}, sell for ${pounds(s.get)}, lose ${pounds(s.pay - s.get)} (${pounds(s.perYear)} a year, ${pounds(s.perTenThousand)} per 10k miles, ${(s.perMile * 100).toFixed(1)}p a mile)`,
    );
    const flagged = ofFuel.some((s) => s.beyondData)
      ? "\n* beyond the ages in our data, so the selling price is extrapolated from the trend."
      : "";
    return [
      `<b>Resale strategy, ${fuel}</b>: buy, drive 10,000 miles a year, sell at 100k miles. Prices come from a model of age and mileage fitted to ${ofFuel[0]!.cars} tracked cars, so they are typical values, not offers.\n${lines.join("\n")}${flagged}`,
    ];
  });
};

export function marketReport(
  observations: Observation[],
  now: Date,
  options: {
    title?: string;
    maxAge?: number;
    benchmark?: { threeYearLoss: number };
  } = {},
): string[] {
  const title = options.title ?? "Toyota RAV4";
  const maxAge = options.maxAge ?? defaultMaxAge;
  const banded = observations.flatMap((o) => {
    const b = band(o.car, o.at, maxAge);
    return b ? [{ ...o, ...b }] : [];
  });
  const forSale = banded.filter((o) => !o.gone).length;
  const header = [
    `<b>${escape(title)} market, under ${maxAge} years old</b>`,
    `AutoTrader (UK-wide) and Used Cars NI: ${forSale} for sale, ${banded.length - forSale} gone since tracking began.`,
    `Updated ${londonDate(now.getTime(), true)}.`,
    "Write-offs, damaged cars, non-runners and private sellers are excluded. Each fuel type is priced separately. Each cell is the median price × number of cars. “Gone” means removed from sale (likely sold) at its last asking price.",
  ].join("\n");
  const sections = [...fuels, null].flatMap((fuel) => {
    const ofFuel = banded.filter((o) => o.car.fuel === fuel);
    if (!ofFuel.length) return [];
    const label = fuelLabel(fuel);
    return Array.from({ length: maxAge }, (_, age) => {
      const rows = ofFuel.filter((o) => o.age === age);
      if (!rows.length) return [];
      const bands = [...new Set(rows.map((o) => o.miles))].sort(
        (a, b) => a - b,
      );
      const prices = (miles: number, gone: boolean) =>
        rows
          .filter((o) => o.miles === miles && o.gone === gone)
          .map((o) => o.car.price);
      const lines = bands.map(
        (miles) =>
          `${milesLabel(miles).padEnd(9)}${cell(prices(miles, false)).padEnd(14)}${cell(prices(miles, true))}`,
      );
      const total = rows.filter((o) => !o.gone).length;
      return [
        `<b>${label} · ${ageLabel(age)}</b>, ${total} for sale, ${rows.length - total} gone\n<pre>${"Miles".padEnd(9)}${"For sale".padEnd(14)}Gone\n${lines.join("\n")}</pre>`,
      ];
    })
      .flat()
      .concat(
        depreciation(ofFuel, {
          title,
          maxAge,
          fuel: label,
          benchmark: options.benchmark,
        }),
      );
  });
  const all = sections.length
    ? [...sections, ...timeToSell(banded), ...resale(observations)]
    : [];
  return all.reduce<string[]>(
    (messages, section) => {
      const last = messages.at(-1)!;
      return last.length + section.length + 2 > 4000
        ? [...messages, section]
        : [...messages.slice(0, -1), `${last}\n\n${section}`];
    },
    [all.length ? header : `${header}\n\nNo cars recorded yet.`],
  );
}

export function valuation(
  car: Car,
  observations: Observation[],
  at: Date,
  maxAge = defaultMaxAge,
): Valuation | undefined {
  const target = band(car, at, maxAge);
  if (!target) return undefined;
  const prices = observations
    .filter((o) => !o.gone && o.car.id !== car.id && o.car.fuel === car.fuel)
    .filter((o) => {
      const b = band(o.car, o.at, maxAge);
      return b?.age === target.age && b.miles === target.miles;
    })
    .map((o) => o.car.price);
  return prices.length >= 3
    ? { median: median(prices), count: prices.length, ...target }
    : undefined;
}

export function alertText(
  car: Car,
  options: { now: Date; firstSeen: number; value?: Valuation | undefined },
): string {
  const [year, month] = car.registered.split("-").map(Number);
  const age = band(car, options.now, 99)?.age;
  const value = options.value;
  const difference = value ? car.price - value.median : 0;
  const comparison = value
    ? `📊 ${pounds(Math.abs(difference))} ${difference <= 0 ? "below" : "above"} the ${pounds(value.median)} median of ${value.count} similar (${ageLabel(value.age).replace(" old", "")}, ${milesLabel(value.miles)} miles)`
    : "📊 Not enough similar cars yet to compare the price";
  const listed = car.listedOn
    ? `🕒 Listed ${londonDate(Date.parse(car.listedOn))}`
    : `🕒 First seen ${londonDate(options.firstSeen, true)} (Used Cars NI shows no listing date; checked every 10 minutes)`;
  return [
    `🆕 <b>${escape(car.title)}</b>`,
    `<b>${pounds(car.price)}</b> · ${car.mileage.toLocaleString("en-GB")} miles · ${fuelLabel(car.fuel)}`,
    `Registered ${new Date(Date.UTC(year!, month! - 1)).toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}${age === undefined ? "" : ` (${age} years old)`}`,
    `📍 ${escape(car.location)} · ${car.source}`,
    listed,
    ...(car.images.length
      ? []
      : ["📷 No photos yet (brand-new stock, photos coming soon)"]),
    comparison,
    `<a href="${escape(car.url)}">Open on ${car.source}</a>`,
  ].join("\n");
}
