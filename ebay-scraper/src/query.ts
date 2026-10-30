import { z } from "zod";

export const markets = {
  com: { currency: "USD", locale: "en-US" },
  "co.uk": { currency: "GBP", locale: "en-GB" },
  de: { currency: "EUR", locale: "de-DE" },
  fr: { currency: "EUR", locale: "fr-FR" },
  it: { currency: "EUR", locale: "it-IT" },
  es: { currency: "EUR", locale: "es-ES" },
  "com.au": { currency: "AUD", locale: "en-AU" },
  ca: { currency: "CAD", locale: "en-CA" },
  at: { currency: "EUR", locale: "de-AT" },
  ch: { currency: "CHF", locale: "de-CH" },
  be: { currency: "EUR", locale: "fr-BE" },
  ie: { currency: "EUR", locale: "en-IE" },
  nl: { currency: "EUR", locale: "nl-NL" },
  pl: { currency: "PLN", locale: "pl-PL" },
  "com.hk": { currency: "HKD", locale: "en-HK" },
  "com.sg": { currency: "SGD", locale: "en-SG" },
  "com.my": { currency: "MYR", locale: "en-MY" },
  ph: { currency: "PHP", locale: "en-PH" },
} as const;

const numeric = z
  .string()
  .regex(/^\d+(?:\.\d+)?$/)
  .transform(Number);
const integer = z
  .union([z.number(), numeric])
  .pipe(z.number().int().positive());
const price = z
  .union([z.number(), numeric])
  .pipe(z.number().finite().min(0).max(1e10));
const sorts = {
  best_match: "12",
  ending_soonest: "1",
  newly_listed: "10",
  price_low_to_high: "2",
  price_high_to_low: "3",
} as const;
const conditions = {
  new: "1000",
  open_box: "1500",
  refurbished: "2000",
  used: "3000",
  for_parts: "7000",
  graded: "2750",
  ungraded: "4000",
} as const;

export const searchQuerySchema = z
  .strictObject({
    query: z.string().trim().min(1).max(500),
    domain: z
      .enum(
        Object.keys(markets) as [
          keyof typeof markets,
          ...(keyof typeof markets)[],
        ],
      )
      .default("com"),
    category_id: z
      .string()
      .regex(/^\d{1,12}$/)
      .optional(),
    page: integer.pipe(z.number().max(1000)).default(1),
    per_page: integer
      .pipe(z.union([z.literal(60), z.literal(120), z.literal(240)]))
      .optional(),
    sort_by: z
      .enum([
        "best_match",
        "ending_soonest",
        "newly_listed",
        "price_low_to_high",
        "price_high_to_low",
      ])
      .optional(),
    condition: z
      .enum([
        "new",
        "open_box",
        "refurbished",
        "used",
        "for_parts",
        "graded",
        "ungraded",
      ])
      .optional(),
    buying_format: z.enum(["auction", "buy_it_now", "best_offer"]).optional(),
    min_price: price.optional(),
    max_price: price.optional(),
    free_shipping: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    location: z.enum(["domestic", "worldwide"]).optional(),
    language: z.enum(["english", "japanese", "chinese", "korean"]).optional(),
  })
  .refine(
    (input) =>
      input.min_price === undefined ||
      input.max_price === undefined ||
      input.min_price <= input.max_price,
    { message: "min_price must not exceed max_price", path: ["min_price"] },
  );

export const completedQuerySchema = searchQuerySchema
  .safeExtend({
    sold_only: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .transform((query) => ({ ...query, completed: true }));

export type SearchQuery = z.infer<typeof searchQuerySchema> & {
  readonly completed?: boolean;
  readonly sold_only?: boolean;
};

export function buildSearchUrl(
  query: SearchQuery,
  format: "canonical" | "form" = query.completed ? "form" : "canonical",
): URL {
  const url = new URL(`https://www.ebay.${query.domain}/sch/i.html`);
  const params: Record<string, string | number | undefined> = {
    _nkw: query.query,
    _pgn: format === "form" || query.page > 1 ? query.page : undefined,
    _ipg: query.per_page,
    _sacat: query.category_id,
    _sop: query.sort_by
      ? sorts[query.sort_by]
      : query.completed
        ? "13"
        : undefined,
    LH_Complete: query.completed ? "1" : undefined,
    LH_Sold: query.completed && query.sold_only ? "1" : undefined,
    LH_ItemCondition: query.condition ? conditions[query.condition] : undefined,
    _udlo: query.min_price,
    _udhi: query.max_price,
    LH_FS: query.free_shipping ? "1" : undefined,
    LH_PrefLoc:
      query.location === "domestic"
        ? "1"
        : query.location === "worldwide"
          ? "2"
          : undefined,
    Language: query.language
      ? query.language[0]?.toUpperCase() + query.language.slice(1)
      : undefined,
  };
  if (query.buying_format)
    params[
      { auction: "LH_Auction", buy_it_now: "LH_BIN", best_offer: "LH_BO" }[
        query.buying_format
      ]
    ] = "1";
  for (const [name, value] of Object.entries(params))
    if (value !== undefined) url.searchParams.set(name, String(value));
  // eBay accepts page one implicitly. Canonical URI encoding also keeps
  // literal plus signs distinct from spaces in complex search expressions.
  if (format === "canonical") url.search = url.search.replace(/\+/g, "%20");
  return url;
}
