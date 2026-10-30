import * as cheerio from "cheerio";
import { z } from "zod";

export const fuels = [
  "Petrol",
  "Diesel",
  "Hybrid",
  "Plug-in hybrid",
  "Electric",
] as const;
export const fuelSchema = z.enum(fuels);
export type Fuel = z.infer<typeof fuelSchema>;
export const fuelType = (text: string): Fuel | null =>
  /plug-?in|phev/i.test(text)
    ? "Plug-in hybrid"
    : /hybrid/i.test(text)
      ? "Hybrid"
      : /electric/i.test(text)
        ? "Electric"
        : /diesel/i.test(text)
          ? "Diesel"
          : /petrol/i.test(text)
            ? "Petrol"
            : null;
// AutoTrader's fuel_type filter values; searching each one tags cars exactly.
export const autoTraderFuels: Readonly<Record<string, Fuel>> = {
  Petrol: "Petrol",
  Diesel: "Diesel",
  "Petrol Hybrid": "Hybrid",
  "Diesel Hybrid": "Hybrid",
  "Petrol Plug-in Hybrid": "Plug-in hybrid",
  "Diesel Plug-in Hybrid": "Plug-in hybrid",
  Electric: "Electric",
};
const normalise = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]/g, "");

export const carSchema = z.object({
  source: z.enum(["AutoTrader", "Used Cars NI"]),
  id: z.string(),
  title: z.string(),
  price: z.number(),
  mileage: z.number(),
  registered: z.string().regex(/^\d{4}-\d{2}$/),
  location: z.string(),
  distanceMiles: z.number().nullable(),
  url: z.string(),
  images: z.array(z.string()),
  listedOn: z.string().nullable(),
  fuel: fuelSchema.nullable().default(null),
});
export type Car = z.infer<typeof carSchema>;

const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
// Insurance write-off categories and wording for damaged or non-running cars.
const damage =
  /\bcat(?:egory)?\.?\s*[-:]?\s*[abcdns]\b|\bcat[abcdns]\b|write[\s-]?off|written[\s-]off|salvage|spares\s*(?:or|and|&|\/)\s*repairs?|non[\s-]?runn(?:er|ing)|structural(?:ly)?\s+damage|accident\s+damage|damaged\s+repairable|flood\s+damage|insurance\s+(?:loss|claim)|engine\s+(?:fault|problem|issue)s?|gearbox\s+(?:fault|problem|issue)s?|needs\s+(?:a\s+)?(?:new\s+)?engine/i;
// Dealers often promise a car has "never been written-off"; that is not a red flag.
const negated =
  /\b(?:never|not|no|nor|free\s+(?:of|from)|clear\s+of|without)\b[^.!?]*$/i;
export const writtenOff = (text: string): boolean =>
  [...text.matchAll(new RegExp(damage.source, "gi"))].some(
    (match) =>
      !negated.test(text.slice(Math.max(0, match.index - 40), match.index)),
  );
const digits = (text: string): number => Number(text.replace(/\D/g, ""));
const month = (year: number, index: number): string =>
  `${year}-${String(index + 1).padStart(2, "0")}`;

const listingSchema = z.object({
  advertId: z.string().regex(/^\d+$/),
  title: z.string(),
  subTitle: z.string().nullish(),
  attentionGrabber: z.string().nullish(),
  sellerType: z.string().nullish(),
  vehicleLocation: z.string().nullish(),
  images: z.array(z.string()).nullish(),
  badges: z
    .array(z.object({ type: z.string(), displayText: z.string() }))
    .nullish(),
  trackingContext: z.object({
    advertContext: z.object({
      model: z.string(),
      year: z.number().int(),
      price: z.number().positive(),
    }),
    distance: z.object({ distance: z.number().nullish() }).nullish(),
  }),
});
const resultSchema = z.object({
  data: z.object({
    searchResults: z.object({
      page: z.object({ count: z.number().int() }),
      listings: z.array(z.unknown()),
    }),
  }),
});

// UK plates: "20" is March 2020, "70" is September 2020. NI plates carry no date.
const plateMonth = (badge: string | undefined, year: number): string => {
  const plate = badge?.match(/\((\d{2}) reg\)/)?.[1];
  if (!plate) return month(Number(badge?.match(/^\d{4}/)?.[0] ?? year), 6);
  const n = Number(plate);
  return n < 50 ? month(2000 + n, 2) : month(2000 + n - 50, 8);
};

const listedOn = (advertId: string): string | null => {
  const date = advertId
    .slice(0, 8)
    .replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
  return Number.isNaN(Date.parse(date)) ? null : date;
};

export function parseAutoTrader(
  body: unknown,
  options: { model: string; fuel: Fuel | null },
): { cars: Car[]; pages: number } {
  const results = z
    .array(z.unknown())
    .parse(body)
    .map((part) => resultSchema.safeParse(part))
    .find((part) => part.success)?.data?.data.searchResults;
  if (!results) throw new Error("Not an AutoTrader search response");
  const cars = results.listings.flatMap((raw): Car[] => {
    const parsed = listingSchema.safeParse(raw);
    if (!parsed.success) return [];
    const listing = parsed.data;
    const advert = listing.trackingContext.advertContext;
    const badge = (type: string) =>
      listing.badges?.find((b) => b.type === type)?.displayText;
    const mileage = badge("MILEAGE");
    if (
      normalise(advert.model) !== normalise(options.model) ||
      listing.sellerType !== "TRADE" ||
      !mileage ||
      writtenOff(
        [listing.title, listing.subTitle, listing.attentionGrabber].join(" "),
      )
    )
      return [];
    return [
      {
        source: "AutoTrader",
        id: listing.advertId,
        title: [listing.title, listing.subTitle].filter(Boolean).join(" "),
        price: advert.price,
        mileage: digits(mileage),
        registered: plateMonth(badge("REGISTERED_YEAR"), advert.year),
        location: listing.vehicleLocation ?? "",
        distanceMiles: listing.trackingContext.distance?.distance ?? null,
        url: `https://www.autotrader.co.uk/car-details/${listing.advertId}`,
        images: (listing.images ?? [])
          .filter((src) => src.startsWith("https://m.atcdn.co.uk/"))
          .slice(0, 4)
          .map((src) => src.replace("{resize}", "w800h600")),
        listedOn: listedOn(listing.advertId),
        fuel: options.fuel,
      },
    ];
  });
  return { cars, pages: results.page.count };
}

export function parseUsedCarsNi(html: string): { cars: Car[]; more: boolean } {
  const $ = cheerio.load(html);
  const cars = $("article.car-line")
    .toArray()
    .flatMap((element): Car[] => {
      const card = $(element);
      const link = card.find(".car-description .car-title a").first();
      const path = link.attr("href")?.split("?")[0] ?? "";
      const id = path.match(/-(\d+)$/)?.[1];
      const heading = link.find("strong").first().clone();
      const date = heading.find("span").text().trim();
      heading.find("span").remove();
      const title = heading.text().replace(/\s+/g, " ").trim();
      const field = (name: string) =>
        card
          .find("dl dt")
          .filter((_, dt) => $(dt).text().trim() === name)
          .first()
          .next("dd")
          .text()
          .trim();
      const price = digits(card.find(".euroPrice").first().text());
      const mileage = digits(field("Mileage"));
      const year = Number(date.match(/\d{4}/)?.[0]);
      const image = card
        .find("source[srcset], img.img-responsive")
        .first()
        .attr("srcset")
        ?.match(
          /^(https:\/\/image\.usedcarsni\.com\/photos\/[\d/]+\.)\d+\.jpg/,
        )?.[1];
      if (
        !id ||
        !/"dealer_id":"\d+"/.test(card.find("script").text()) ||
        writtenOff(`${title} ${link.attr("title") ?? ""}`) ||
        !price ||
        !mileage ||
        !year
      )
        return [];
      const index = months.indexOf(date.slice(0, 3));
      return [
        {
          source: "Used Cars NI",
          id,
          title,
          price,
          mileage,
          registered: month(year, index < 0 ? 6 : index),
          location: field("Location"),
          distanceMiles: null,
          url: `https://www.usedcarsni.com${path}`,
          images: image ? [`${image}600.jpg`] : [],
          listedOn: null,
          fuel: fuelType(field("Fuel Type")),
        },
      ];
    });
  const more = $("a")
    .toArray()
    .some((a) => $(a).text().trim() === "Next");
  return { cars, more };
}

export function parseCatalogue(
  html: string,
  field: "make" | "model",
): { id: string; name: string }[] {
  const $ = cheerio.load(html);
  return $(`select[name="${field}"]`)
    .first()
    .find("option")
    .toArray()
    .flatMap((option) => {
      const id = $(option).attr("value") ?? "";
      const name = $(option)
        .text()
        .replace(/\s*\(\d[\d,]*\)\s*$/, "")
        .trim();
      return /^[1-9]\d*$/.test(id) && name ? [{ id, name }] : [];
    });
}

export const sameName = (a: string, b: string): boolean =>
  normalise(a) === normalise(b);
