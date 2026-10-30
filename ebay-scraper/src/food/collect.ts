import {
  parseAsda,
  parseBm,
  parseLidl,
  parseSainsburys,
  parseDeals,
  parseTesco,
  type PriceOffer,
  type Shop,
} from "./prices.js";

export type ShopPage = { html: string; responses: string[] };

const json = (page: ShopPage, key: string): unknown => {
  for (const text of page.responses) {
    try {
      const value: unknown = JSON.parse(text);
      if (typeof value === "object" && value !== null && key in value)
        return value;
    } catch {}
  }
  throw new Error(`No ${key} data`);
};
// Supermarkets always stock Pepsi Max; an empty result means a blocked page.
const sources: readonly {
  shop: Shop;
  url: string;
  parse: (page: ShopPage) => PriceOffer[];
  mustFind: boolean;
}[] = [
  {
    shop: "Tesco",
    url: "https://www.tesco.com/groceries/en-GB/search?query=pepsi%20max%20cans",
    parse: (page) => parseTesco(page.html),
    mustFind: true,
  },
  {
    shop: "Asda",
    url: "https://www.asda.com/groceries/search/pepsi%20max%20cans",
    parse: (page) => parseAsda(json(page, "hits")),
    mustFind: true,
  },
  {
    shop: "Sainsbury's",
    url: "https://www.sainsburys.co.uk/groceries-api/gol-services/product/v1/product?filter%5Bkeyword%5D=pepsi%20max&page_number=1&page_size=60",
    parse: (page) => parseSainsburys(json(page, "products")),
    mustFind: true,
  },
  {
    shop: "Lidl",
    url: "https://www.lidl-ni.co.uk/q/api/search?q=pepsi%20max&fetchsize=48&locale=en_GB&assortment=GB&version=v2.0.0",
    parse: (page) => parseLidl(json(page, "items")),
    mustFind: false,
  },
  {
    shop: "Spar",
    url: "https://www.spar-ni.co.uk/deals/",
    parse: (page) => parseDeals(page.html, "Spar"),
    mustFind: false,
  },
  {
    shop: "Eurospar",
    url: "https://www.eurosparni.co.uk/super-deals/super-deals/",
    parse: (page) => parseDeals(page.html, "Eurospar"),
    mustFind: false,
  },
  ...[
    "https://www.bmstores.co.uk/products/pepsi-max-18-x-330ml-402775",
    "https://www.bmstores.co.uk/products/pepsi-max-8-x-330ml-307565",
  ].map((url) => ({
    shop: "B&M" as const,
    url,
    parse: (page: ShopPage) => parseBm(page.html, url),
    mustFind: true,
  })),
];

export async function collectPrices(
  load: (url: string) => Promise<ShopPage>,
): Promise<{ offers: PriceOffer[]; failed: Shop[] }> {
  const offers: PriceOffer[] = [];
  const failed: Shop[] = [];
  for (const source of sources) {
    try {
      const found = source.parse(await load(source.url));
      if (source.mustFind && !found.length) throw new Error("Nothing found");
      offers.push(...found);
    } catch {
      if (!failed.includes(source.shop)) failed.push(source.shop);
    }
  }
  return { offers, failed };
}

export function reportSlot(now: Date): string | undefined {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return ["Mon", "Thu"].includes(parts["weekday"] ?? "") &&
    Number(parts["hour"]) >= 8
    ? `${parts["year"]}-${parts["month"]}-${parts["day"]}`
    : undefined;
}
