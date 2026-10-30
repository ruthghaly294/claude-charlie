import * as cheerio from "cheerio";
import { z } from "zod";

export type Shop =
  "Tesco" | "Sainsbury's" | "Asda" | "Lidl" | "Spar" | "Eurospar" | "B&M";
export type MemberPrice = {
  price: number;
  label: string;
  buy?: number;
  until?: string;
};
export type PriceOffer = {
  shop: Shop;
  title: string;
  url: string;
  count: number;
  ml: number;
  format: "can" | "bottle";
  standard: number | null;
  member: MemberPrice | null;
  upTo?: boolean;
  note?: string;
  until?: string;
};

const variants =
  /cherry|lime|caffeine|tropical|mango|raspberry|ginger|vanilla|captain|morgan|rum|premix|diet|treats|cream|strawberr/i;
export const isPepsiMax = (title: string): boolean =>
  /pepsi\s+max/i.test(title) && !variants.test(title);

export function packSize(
  text: string,
): { count: number; ml: number } | undefined {
  const multi = /(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(ml|l)?\b/i.exec(text);
  if (multi) {
    const size = Number(multi[2]);
    return {
      count: Number(multi[1]),
      ml: multi[3]?.toLowerCase() === "l" ? size * 1000 : size,
    };
  }
  const single = /(\d+(?:\.\d+)?)\s*(ml|l|litres?)\b/i.exec(text);
  if (!single) return undefined;
  const size = Number(single[1]);
  return {
    count: 1,
    ml: single[2]!.toLowerCase() === "ml" ? size : size * 1000,
  };
}
const offer = (
  input: Omit<PriceOffer, "count" | "ml" | "format">,
  size: string,
): PriceOffer[] => {
  const pack = packSize(size);
  if (!pack || !isPepsiMax(input.title)) return [];
  return [
    {
      ...input,
      ...pack,
      format: [150, 250, 330, 440].includes(pack.ml) ? "can" : "bottle",
    },
  ];
};
const money = (value: number) => `£${value.toFixed(2)}`;

export function parseTesco(html: string): PriceOffer[] {
  const $ = cheerio.load(html);
  return $("li[data-testid]")
    .toArray()
    .flatMap((tile) => {
      const link = $(tile).find("h2 a").first();
      const text = $(tile)
        .find("*")
        .contents()
        .filter((_, node) => node.type === "text")
        .map((_, node) => $(node).text().trim())
        .get()
        .filter(Boolean)
        .join(" | ");
      const standard = /£(\d+\.\d{2}) \| £[\d.]+\/litre/.exec(text);
      const card = /£(\d+\.\d{2})(?: [^|]*)? Clubcard Price/.exec(text);
      const until = /until (\d{2}\/\d{2}\/\d{4})/.exec(text)?.[1];
      return offer(
        {
          shop: "Tesco",
          title: link.text().trim(),
          url: link.attr("href") ?? "https://www.tesco.com/groceries/",
          standard: standard ? Number(standard[1]) : null,
          member: card
            ? {
                price: Number(card[1]),
                label: "Clubcard Price",
                ...(until ? { until } : {}),
              }
            : null,
        },
        link.text(),
      );
    });
}

const sainsburysSchema = z.object({
  products: z.array(
    z.object({
      name: z.string(),
      full_url: z.string(),
      retail_price: z.object({ price: z.number() }),
      promotions: z.array(z.object({ strap_line: z.string() })).default([]),
    }),
  ),
});
export function parseSainsburys(input: unknown): PriceOffer[] {
  return sainsburysSchema.parse(input).products.flatMap((product) => {
    const deal = product.promotions
      .map((p) =>
        /Buy any (\d+) for £(\d+(?:\.\d+)?) with Nectar/i.exec(p.strap_line),
      )
      .find(Boolean);
    return offer(
      {
        shop: "Sainsbury's",
        title: product.name,
        url: product.full_url,
        standard: product.retail_price.price,
        member: deal
          ? {
              price: Number(deal[2]) / Number(deal[1]),
              buy: Number(deal[1]),
              label: `Any ${deal[1]} for ${money(Number(deal[2]))} with Nectar`,
            }
          : null,
      },
      product.name,
    );
  });
}

const asdaSchema = z.object({
  hits: z.array(
    z.object({
      CIN: z.string(),
      NAME: z.string(),
      BRAND: z.string(),
      PACK_SIZE: z.string(),
      PRICES: z.object({
        EN: z.object({
          PRICE: z.number(),
          OFFER: z.string().optional(),
          WASPRICE: z.number().optional(),
        }),
      }),
    }),
  ),
});
export function parseAsda(input: unknown): PriceOffer[] {
  return asdaSchema.parse(input).hits.flatMap((hit) =>
    /^pepsi( max)?$/i.test(hit.BRAND)
      ? offer(
          {
            shop: "Asda",
            title: `${hit.BRAND} ${hit.NAME}`,
            url: "https://www.asda.com/groceries/search/pepsi%20max",
            standard: hit.PRICES.EN.PRICE,
            member: null,
            ...(hit.PRICES.EN.WASPRICE
              ? {
                  note: `${hit.PRICES.EN.OFFER ?? "Offer"}, was ${money(hit.PRICES.EN.WASPRICE)}`,
                }
              : {}),
          },
          hit.PACK_SIZE.replace(/^(\d+)X(\d+)$/i, "$1x$2ml"),
        )
      : [],
  );
}

const lidlPrice = z.object({
  price: z.number().optional(),
  packaging: z.object({ text: z.string() }).optional(),
  discount: z.object({ discountText: z.string().optional() }).optional(),
});
const lidlSchema = z.object({
  items: z.array(
    z.object({
      gridbox: z.object({
        data: z.object({
          fullTitle: z.string(),
          canonicalUrl: z.string(),
          price: lidlPrice.optional(),
          lidlPlus: z.array(z.object({ price: lidlPrice })).optional(),
          keyfacts: z
            .object({ supplementalDescription: z.string().optional() })
            .optional(),
        }),
      }),
    }),
  ),
});
export function parseLidl(input: unknown): PriceOffer[] {
  return lidlSchema.parse(input).items.flatMap(({ gridbox: { data } }) => {
    const plus = data.lidlPlus?.[0]?.price;
    const regular = /£(\d+(?:\.\d+)?)/.exec(plus?.packaging?.text ?? "");
    const buy = Number(
      /(\d+) FOR/i.exec(plus?.discount?.discountText ?? "")?.[1] ?? 1,
    );
    return offer(
      {
        shop: "Lidl",
        title: data.fullTitle,
        url: `https://www.lidl-ni.co.uk${data.canonicalUrl}`,
        standard: data.price?.price ?? (regular ? Number(regular[1]) : null),
        member:
          plus?.price !== undefined
            ? {
                price: plus.price / buy,
                ...(buy > 1 ? { buy } : {}),
                label: `${buy > 1 ? `${buy} for ` : ""}${money(plus.price)} with Lidl Plus`,
              }
            : null,
      },
      data.keyfacts?.supplementalDescription ?? data.fullTitle,
    );
  });
}

const dealText =
  /\b(was £|any \d+ for £|half price|special offer|save|less than|everyday value)/i;
export function parseDeals(
  html: string,
  shop: "Spar" | "Eurospar",
): PriceOffer[] {
  const $ = cheerio.load(html);
  const texts = $.root()
    .find("*")
    .contents()
    .filter((_, node) => node.type === "text")
    .map((_, node) => $(node).text().replace(/\s+/g, " ").trim())
    .get()
    .filter(Boolean);
  const until =
    /\d{1,2}(?:st|nd|rd|th)? \w+ - (\d{1,2}(?:st|nd|rd|th)? \w+ \d{4})/.exec(
      texts.join(" "),
    )?.[1];
  return texts.flatMap((text, index) => {
    const title = texts[index - 1];
    if (!title || !dealText.test(text)) return [];
    const multibuy = /any (\d+) for £(\d+(?:\.\d+)?)/i.exec(text);
    const was = /was £(\d+(?:\.\d+)?)/i.exec(text);
    const share = /1\/2|half/i.test(text)
      ? 0.5
      : /save over 1\/3/i.test(text)
        ? 2 / 3
        : 1;
    const price = multibuy
      ? Number(multibuy[2]) / Number(multibuy[1])
      : was
        ? Number(was[1]) * share
        : undefined;
    if (price === undefined) return [];
    return offer(
      {
        shop,
        title,
        url:
          shop === "Spar"
            ? "https://www.spar-ni.co.uk/deals/"
            : "https://www.eurosparni.co.uk/super-deals/super-deals/",
        standard: price,
        member: null,
        ...(multibuy ? {} : { upTo: true }),
        note: text.replace(/^.*?\.\s+/, "").replace(/\.$/, ""),
        ...(until ? { until } : {}),
      },
      text.replace(/litre/i, "L"),
    );
  });
}

export function parseBm(html: string, url: string): PriceOffer[] {
  const $ = cheerio.load(html);
  const title = $("h1").first().text().trim();
  if (!isPepsiMax(title)) return [];
  const product = $(".bm-product-price-card")
    .first()
    .find("*")
    .contents()
    .filter((_, node) => node.type === "text")
    .map((_, node) => $(node).text().trim())
    .get()
    .filter(Boolean)
    .join(" ");
  const price = /£\s*(\d+(?:\.\d{1,2})?)/.exec(product);
  if (!price) return [];
  const multibuy = /(\d+)\s+FOR\s+£\s*(\d+(?:\.\d{1,2})?)/i.exec(product);
  const regular = Number(price[1]);
  const multiPrice = multibuy
    ? Number(multibuy[2]) / Number(multibuy[1])
    : Infinity;
  return offer(
    {
      shop: "B&M",
      title,
      url,
      standard: Math.min(regular, multiPrice),
      member: null,
      note: `${multiPrice < regular ? `${multibuy![1]} for £${multibuy![2]}; £${regular.toFixed(2)} single pack. ` : ""}In-store, subject to availability`,
    },
    title,
  );
}

export const pencePer100ml = (
  price: number,
  pack: { count: number; ml: number },
): number => (price * 10000) / (pack.count * pack.ml);

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const volume = (ml: number) => (ml >= 1000 ? `${ml / 1000}L` : `${ml}ml`);
const pack = (o: PriceOffer) =>
  o.format === "can"
    ? `${o.count}×${o.ml}ml`
    : `${o.count > 1 ? `${o.count}×` : ""}${volume(o.ml)}`;
const label = (o: PriceOffer) =>
  o.format === "can" ? pack(o) : `${pack(o)} bottle${o.count > 1 ? "s" : ""}`;
const best = (o: PriceOffer) =>
  Math.min(o.member?.price ?? Infinity, o.standard ?? Infinity);
const pence = (price: number, o: PriceOffer) =>
  `${pencePer100ml(price, o).toFixed(1)}p`;
const headline = (o: PriceOffer) =>
  `<b>${o.upTo ? "under " : ""}${pence(best(o), o)}</b>`;
function detail(o: PriceOffer): string {
  const parts = o.upTo
    ? []
    : o.member
      ? [
          `${money(o.member.price)}${o.member.buy ? ` each when you buy ${o.member.buy} (${o.member.label})` : ` ${o.member.label}`}${o.member.until ? ` until ${o.member.until}` : ""}`,
          ...(o.standard !== null
            ? [`${money(o.standard)} standard (${pence(o.standard, o)})`]
            : []),
        ]
      : o.standard !== null
        ? [money(o.standard)]
        : [];
  return escape(
    [
      ...parts,
      ...(o.note ? [o.note] : []),
      ...(o.until ? [`deal ends ${o.until}`] : []),
    ].join(" · "),
  );
}
const cheapest = (list: readonly PriceOffer[]) =>
  [...list].sort(
    (a, b) => pencePer100ml(best(a), a) - pencePer100ml(best(b), b),
  );
const ranked = (list: readonly PriceOffer[]) =>
  list.flatMap((o, i) => [
    `<b>${i + 1}.</b> ${escape(o.shop)} · ${label(o)} — ${headline(o)}`,
    `     ${detail(o)}`,
  ]);

export function priceReport(
  offers: readonly PriceOffer[],
  options: { failed: readonly Shop[]; now: Date },
): string {
  const unique = [
    ...new Map(
      cheapest(offers.filter((o) => Number.isFinite(best(o))))
        .reverse()
        .map((o) => [`${o.shop}|${o.count}|${o.ml}|${o.format}`, o] as const),
    ).values(),
  ];
  const overall = cheapest(unique)[0];
  const noCard = cheapest(
    unique
      .filter((o) => o.standard !== null)
      .map((o) => ({ ...o, member: null })),
  )[0];
  const cans = cheapest(
    unique.filter((o) => o.format === "can" && o.count >= 6),
  );
  const bottles = cheapest(unique.filter((o) => o.format === "bottle"));
  const day = options.now.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  });
  const feature = (heading: string, o: PriceOffer | undefined) =>
    o
      ? [
          `<b>${heading}</b>\n${escape(o.shop)} · ${label(o)} — ${headline(o)}/100ml\n     ${detail(o)}`,
        ]
      : [];
  const deals = (["Spar", "Eurospar", "B&M"] as const).map((shop) => {
    const found = unique.filter((o) => o.shop === shop);
    return `• ${escape(shop.toUpperCase())}: ${
      options.failed.includes(shop)
        ? "couldn't check this time"
        : found.length
          ? found
              .map((o) => `${pack(o)} — ${headline(o)}/100ml · ${detail(o)}`)
              .join("; ")
          : "no Pepsi Max deal this period"
    }`;
  });
  return [
    `<b>🥤 Pepsi Max · best price per 100 ml</b>\n<i>${day} · Northern Ireland</i>`,
    ...feature("🏆 Cheapest overall", overall),
    ...feature("💷 Cheapest without a loyalty card", noCard),
    `<b>🥫 Can multipacks</b>\n${cans.length ? ranked(cans.slice(0, 8)).join("\n") : "None found this time."}`,
    ...(bottles.length
      ? [`<b>🍾 Bottles</b>\n${ranked(bottles.slice(0, 5)).join("\n")}`]
      : []),
    `<b>🏪 SPAR · EUROSPAR · B&amp;M</b>\n${deals.join("\n")}`,
    ...(options.failed.length
      ? [
          `⚠️ Couldn't check: ${options.failed.join(", ")} — will retry next run.`,
        ]
      : []),
    "<i>Online prices can differ from NI stores. Multibuys are priced per pack when you buy the stated number.</i>",
  ].join("\n\n");
}
