import { z } from "zod";
import { facebookListingSchema, type FacebookListing } from "./contract.js";
import { coordinatesSchema, type Coordinates } from "./geo.js";

const nodeSchema = z.object({
  id: z.string().regex(/^\d+$/),
  marketplace_listing_title: z.string().trim().min(1),
  primary_listing_photo: z
    .object({ image: z.object({ uri: z.url() }) })
    .nullish(),
  listing_price: z
    .object({ amount: z.string(), formatted_amount: z.string() })
    .nullish(),
  location: z
    .object({
      reverse_geocode: z
        .object({
          city: z.string().nullish(),
          city_page: z.object({ display_name: z.string() }).nullish(),
        })
        .nullish(),
    })
    .nullish(),
  is_sold: z.boolean().nullish(),
  is_pending: z.boolean().nullish(),
  is_live: z.boolean().nullish(),
  is_hidden: z.boolean().nullish(),
  creation_time: z.number().int().positive().nullish(),
});
const currencies: Record<string, string> = { "£": "GBP", "€": "EUR" };

function* objects(payloads: readonly string[]): Generator<object> {
  const visit = function* (value: unknown): Generator<object> {
    if (!value || typeof value !== "object") return;
    yield value;
    for (const child of Object.values(value)) yield* visit(child);
  };
  for (const payload of payloads)
    for (const line of payload.split("\n")) {
      let json: unknown;
      try {
        json = JSON.parse(line.replace(/^for\s*\(;;\);/, ""));
      } catch {
        continue;
      }
      yield* visit(json);
    }
}

function listing(node: z.infer<typeof nodeSchema>): FacebookListing {
  const raw = node.listing_price?.formatted_amount.trim();
  const value = Number(node.listing_price?.amount);
  const symbol = raw?.match(/^[^\d\s]+/)?.[0];
  const geocode = node.location?.reverse_geocode;
  return facebookListingSchema.parse({
    id: node.id,
    title: node.marketplace_listing_title,
    url: `https://www.facebook.com/marketplace/item/${node.id}/`,
    image: node.primary_listing_photo?.image.uri ?? null,
    price:
      raw && /^free$/i.test(raw)
        ? { value: 0, currency: "GBP", symbol: "£", raw: "Free" }
        : raw && symbol && currencies[symbol] && Number.isFinite(value)
          ? { value, currency: currencies[symbol], symbol, raw }
          : null,
    locationName: geocode?.city_page?.display_name ?? geocode?.city ?? null,
    coordinates: null,
    availability: node.is_sold
      ? "sold"
      : node.is_pending
        ? "pending"
        : node.is_live && !node.is_hidden
          ? "available"
          : "unknown",
    listedAt: node.creation_time
      ? new Date(node.creation_time * 1000).toISOString()
      : null,
  });
}

export function parseSearchPayloads(
  payloads: readonly string[],
): FacebookListing[] {
  const found = new Map<string, FacebookListing>();
  for (const value of objects(payloads)) {
    const node = nodeSchema.safeParse(value);
    if (node.success && !found.has(node.data.id))
      found.set(node.data.id, listing(node.data));
  }
  return [...found.values()];
}

const targetSchema = z.object({
  marketplace_listing_renderable_target: z.object({
    id: z.string(),
    location: coordinatesSchema,
  }),
});
export function parseListingCoordinates(
  payloads: readonly string[],
  id: string,
): Coordinates | null {
  for (const value of objects(payloads)) {
    const target = targetSchema.safeParse(value);
    if (
      target.success &&
      target.data.marketplace_listing_renderable_target.id === id
    )
      return target.data.marketplace_listing_renderable_target.location;
  }
  return null;
}

export function parseListingTime(
  payloads: readonly string[],
  id: string,
): string | null {
  for (const value of objects(payloads)) {
    const node = z
      .object({ id: z.string(), creation_time: z.number().int().positive() })
      .safeParse(value);
    if (node.success && node.data.id === id)
      return new Date(node.data.creation_time * 1000).toISOString();
  }
  return null;
}

export function hasEmptySearchFeed(payloads: readonly string[]): boolean {
  const noResults = z.object({
    node: z.object({
      __typename: z.literal("MarketplaceSearchFeedNoResults"),
      story_type: z.literal("SERP_NO_RESULTS"),
    }),
  });
  const schema = z.object({
    marketplace_search: z.object({
      feed_units: z.object({ edges: z.array(z.unknown()) }),
    }),
  });
  for (const value of objects(payloads)) {
    const parsed = schema.safeParse(value);
    if (parsed.success) {
      const edges = parsed.data.marketplace_search.feed_units.edges;
      if (
        !edges.length ||
        edges.some((edge) => noResults.safeParse(edge).success)
      )
        return true;
    }
  }
  return false;
}

export function searchHasMore(
  payloads: readonly string[],
): boolean | undefined {
  let more: boolean | undefined;
  for (const value of objects(payloads)) {
    const node = value as Record<string, unknown>;
    if (
      node["__typename"] === "MarketplaceSearchFeedNoResults" &&
      node["story_type"] === "SERP_NO_RESULTS"
    )
      return false;
    const search = node["marketplace_search"] as
      { feed_units?: { page_info?: { has_next_page?: unknown } } } | undefined;
    const page =
      node["__typename"] === "MarketplaceSearchFeed"
        ? (node["page_info"] as { has_next_page?: unknown } | undefined)
        : search?.feed_units?.page_info;
    if (typeof page?.has_next_page === "boolean") more = page.has_next_page;
  }
  return more;
}
