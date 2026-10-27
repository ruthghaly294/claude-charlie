import { load, type CheerioAPI } from "cheerio";
import {
  listingSchema,
  searchResponseSchema,
  type Money,
  type Listing,
  type SearchResponse,
} from "./contract.js";
import { markets, type SearchQuery } from "./query.js";
import { ScrapeError, ebaySignInRequired } from "./errors.js";
import { completionDetails } from "./completed.js";

type Domain = SearchQuery["domain"];
const clean = (value: string): string => value.replace(/\s+/g, " ").trim();
const symbols: Readonly<Record<string, string>> = {
  GBP: "£",
  EUR: "€",
  USD: "$",
  AUD: "AU $",
  CAD: "C $",
  CHF: "CHF",
  PLN: "zł",
  HKD: "HK $",
  SGD: "S $",
  MYR: "RM",
  PHP: "₱",
};

export function parseMoney(raw: string, domain: Domain): Money | null {
  const text = clean(raw);
  if (/\d\s*(?:to|bis|à|a|–|-)\s*[^\d]*\d/i.test(text)) return null;
  const explicit = text.match(
    /\b(USD|GBP|EUR|AUD|CAD|CHF|PLN|HKD|SGD|MYR|PHP)\b/,
  )?.[1];
  const symbolMatch = text.match(
    /US\s*\$|AU\s*\$|C\s*\$|HK\s*\$|S\s*\$|£|€|\$|zł|RM|₱/,
  );
  if (!explicit && !symbolMatch) return null;
  const symbolCurrencies: Readonly<Record<string, string>> = {
    US$: "USD",
    AU$: "AUD",
    C$: "CAD",
    HK$: "HKD",
    S$: "SGD",
    "£": "GBP",
    "€": "EUR",
    zł: "PLN",
    RM: "MYR",
    "₱": "PHP",
  };
  const symbol = symbolMatch?.[0] ?? explicit ?? "";
  const currency =
    explicit ??
    symbolCurrencies[symbol.replace(/\s/g, "")] ??
    markets[domain].currency;
  let digits = text
    .match(/\d[\d\s.,'’]*/)?.[0]
    .trim()
    .replace(/[\s'’]/g, "");
  if (!digits) return null;
  const commaDecimal =
    /^(de|fr|it|es|at|be|nl|pl)$/.test(domain) && !/US\s*\$|AU\s*\$/.test(text);
  if (digits.includes(",") && digits.includes(".")) {
    digits =
      digits.lastIndexOf(",") > digits.lastIndexOf(".")
        ? digits.replaceAll(".", "").replace(",", ".")
        : digits.replaceAll(",", "");
  } else if (commaDecimal) {
    digits = digits.replaceAll(".", "").replace(",", ".");
  } else {
    digits = digits.replaceAll(",", "");
  }
  const value = Number(digits);
  return Number.isFinite(value)
    ? { value, currency, symbol: symbols[currency] ?? symbol, raw: text }
    : null;
}

function itemUrl(href: string, domain: Domain): URL | null {
  try {
    const url = new URL(href, `https://www.ebay.${domain}`);
    if (
      url.protocol !== "https:" ||
      !Object.keys(markets).some(
        (market) =>
          url.hostname === `www.ebay.${market}` ||
          url.hostname === `ebay.${market}`,
      )
    )
      return null;
    return /\/itm\/(?:[^/]+\/)?\d{9,15}(?:[/?]|$)/.test(url.pathname)
      ? url
      : null;
  } catch {
    return null;
  }
}

function listing(
  $: CheerioAPI,
  node: Parameters<CheerioAPI>[0],
  query: SearchQuery,
  position: number,
): Listing | null {
  const card = $(node);
  const domain = query.domain;
  card.find(".clipped, .s-item__ad-badge, .s-card__ad-badge").remove();
  const title = clean(
    card.find(".s-card__title, .s-item__title").first().text(),
  );
  const href = card.find('a[href*="/itm/"]').first().attr("href") ?? "";
  const url = itemUrl(href, domain);
  const id = url?.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})/)?.[1];
  if (!url || !id || !title || /^(shop on ebay|new listing)$/i.test(title))
    return null;
  const price = parseMoney(
    card.find(".s-card__price, .s-item__price").first().text(),
    domain,
  );
  const rows = card
    .find(
      ".s-card__attribute-row, .s-card__footer--row, .s-item__shipping, .s-item__logisticsCost, .s-item__bids, .s-item__purchase-options, .s-item__time-left, .s-item__itemLocation, .s-item__returns, .s-item__hotness, .s-item__etrs-text",
    )
    .toArray()
    .map((element) => clean($(element).text()))
    .filter(Boolean);
  const find = (pattern: RegExp): string | null =>
    rows.find((row) => pattern.test(row)) ?? null;
  const shipping = find(
    /shipping|delivery|postage|versand|livraison|spedizione|envío|verzending/i,
  );
  const free =
    shipping &&
    /\b(free|kostenlos|gratuit|gratis|gratuita|gratuito)\b/i.test(shipping)
      ? true
      : null;
  const bids = find(/\b\d+\s+(bids?|gebote?)\b/i)?.match(/\d+/)?.[0];
  const auction =
    bids !== undefined
      ? true
      : find(/buy it now|best offer|sofort.kaufen/i)
        ? false
        : null;
  const format =
    bids !== undefined
      ? "Auction"
      : find(/best offer/i)
        ? "Best Offer"
        : find(/buy it now|sofort.kaufen/i)
          ? "Buy It Now"
          : null;
  const img = card.find("img").first();
  const image = img.attr("data-src") ?? img.attr("src") ?? null;
  const safeImage =
    image && /^https:\/\/(?:[\w-]+\.)*ebayimg\.com\//i.test(image)
      ? image
      : null;
  const watchers = find(/\bwatchers?\b/i)?.match(/[\d,]+/)?.[0];
  const completed = query.completed
    ? completionDetails(
        clean(
          card
            .find(
              ".s-card__caption, .s-card__attribute-row, .s-card__footer--row, .s-item__caption, .s-item__title--tagblock, .s-item__endedDate",
            )
            .map((_, element) => $(element).text())
            .get()
            .join(" "),
        ),
        price,
        card.find(
          ".s-card__price .STRIKETHROUGH, .s-card__price.STRIKETHROUGH, .s-card__price s, .s-item__price s, .s-item__price.STRIKETHROUGH",
        ).length > 0,
      )
    : null;
  if (
    query.completed &&
    (!completed || (query.sold_only && completed.is_sold !== true))
  )
    return null;
  return listingSchema.parse({
    position,
    item_id: id,
    product_id: url.searchParams.get("epid"),
    title,
    url: `https://www.ebay.${domain}/itm/${id}`,
    image: safeImage,
    price,
    currency: price?.currency ?? null,
    condition:
      clean(
        card
          .find(
            ".s-card__subtitle, .s-item__subtitle .SECONDARY_INFO, .s-item__subtitle",
          )
          .first()
          .text(),
      ) || null,
    buying_format: format,
    is_auction: auction,
    bids: bids === undefined ? null : Number(bids),
    current_bid: auction ? price : null,
    time_left: find(/\bleft\b|verbleibend/i),
    shipping,
    shipping_cost: free || !shipping ? null : parseMoney(shipping, domain),
    free_shipping: free,
    watchers: watchers ? Number(watchers.replaceAll(",", "")) : null,
    location: find(/^from |^located in |^aus /i),
    returns: find(/returns?|rückgabe/i),
    program_badge: find(
      /authenticity guarantee|top rated plus|ebay refurbished/i,
    ),
    ...(completed ?? {}),
  });
}

export function parseSearchHtml(
  html: string,
  query: SearchQuery,
  now = new Date(),
): SearchResponse {
  const $ = load(html);
  if (
    $('input[name="userid"], #signin-form, form[action*="signin.ebay"]')
      .length ||
    /^sign in(?: or register)?\s*\|\s*ebay/i.test($("title").text().trim())
  )
    throw ebaySignInRequired();
  const heading = clean($("title, h1, .error-header__headline").text());
  if (
    /access denied|pardon our interruption|error page \| ebay|security measure|robot check|captcha/i.test(
      heading,
    ) ||
    $('form[action*="splashui"], #captcha_form, #error-info').length
  ) {
    throw new ScrapeError(
      "UPSTREAM_BLOCKED",
      "eBay blocked this request; no listings were returned.",
    );
  }
  const countText = clean($(".srp-controls__count-heading").first().text());
  const count = countText.match(/[\d][\d.,\s]*/)?.[0];
  const total = count ? Number(count.replace(/[^\d]/g, "")) : null;
  const seen = new Set<string>();
  const results: Listing[] = [];
  if (total !== 0)
    $(".srp-results > .s-card, .srp-results > .s-item").each((_, node) => {
      const item = listing($, node, query, results.length + 1);
      if (item && !seen.has(item.item_id)) {
        results.push(item);
        seen.add(item.item_id);
      }
    });
  if (results.length === 0 && total !== 0)
    throw new ScrapeError(
      "UPSTREAM_MARKUP_CHANGED",
      "eBay search markup was not recognized; refusing to return an empty result.",
    );
  const hasMore =
    total !== 0 &&
    $('a.pagination__next:not([aria-disabled="true"]), a[rel="next"]')
      .toArray()
      .some((node) => {
        try {
          const href = new URL(
            $(node).attr("href") ?? "",
            `https://www.ebay.${query.domain}`,
          );
          return (
            href.hostname === `www.ebay.${query.domain}` &&
            Number(href.searchParams.get("_pgn")) > query.page
          );
        } catch {
          return false;
        }
      });
  return searchResponseSchema.parse({
    query: query.query,
    domain: query.domain,
    category_id: query.category_id ?? null,
    sold: Boolean(query.completed && query.sold_only),
    ...(query.completed ? { completed: true } : {}),
    results,
    facets: {},
    pagination: {
      current_page: query.page,
      per_page: query.per_page ?? null,
      returned: results.length,
      total_results: total,
      total_pages:
        total !== null && query.per_page && !/[+]/.test(countText)
          ? Math.ceil(total / query.per_page)
          : null,
      has_more: hasMore,
    },
    scraped_utc: now.getTime() / 1000,
    scraped_at: now.toISOString(),
  });
}
