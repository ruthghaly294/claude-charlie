import { z } from "zod";

export const moneySchema = z.strictObject({
  value: z.number().finite(),
  currency: z.string(),
  symbol: z.string(),
  raw: z.string(),
});
export type Money = z.infer<typeof moneySchema>;
const text = z.string().nullable().default(null);
const number = z.number().finite().nullable().default(null);
const flag = z.boolean().nullable().default(null);
const money = moneySchema.nullable().default(null);

export const listingSchema = z.strictObject({
  position: z.number().int().positive(),
  item_id: z.string().regex(/^\d+$/),
  product_id: text,
  title: z.string().min(1),
  url: z.url(),
  image: text,
  price: money,
  original_price: money,
  discount_percent: number,
  currency: text,
  condition: text,
  brand: text,
  buying_format: text,
  is_auction: flag,
  bids: number,
  current_bid: money,
  time_left: text,
  shipping: text,
  shipping_cost: money,
  free_shipping: flag,
  location: text,
  returns: text,
  sold_count: number,
  sold_date: text,
  sold_date_at: text,
  watchers: number,
  coupon: text,
  rating: number,
  ratings_total: number,
  seller_name: text,
  seller_feedback_percent: number,
  seller_feedback_score: number,
  program_badge: text,
  is_sponsored: flag,
  exact_match: flag,
  is_sold: z.boolean().nullable().optional(),
  ended_date: z.string().nullable().optional(),
  sale_price: moneySchema.nullable().optional(),
  best_offer_accepted: z.boolean().optional(),
});
export type Listing = z.infer<typeof listingSchema>;

export const searchResponseSchema = z.strictObject({
  query: z.string(),
  domain: z.string(),
  category_id: z.string().nullable(),
  sold: z.boolean(),
  completed: z.boolean().optional(),
  results: z.array(listingSchema),
  facets: z.record(z.string(), z.unknown()),
  pagination: z.strictObject({
    current_page: z.number().int().positive(),
    per_page: z.number().nullable(),
    returned: z.number().int().nonnegative(),
    total_results: z.number().nullable(),
    total_pages: z.number().nullable(),
    has_more: z.boolean(),
  }),
  scraped_utc: z.number(),
  scraped_at: z.iso.datetime(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
