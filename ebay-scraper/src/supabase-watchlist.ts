import { PostgrestClient } from "@supabase/postgrest-js";
import { z } from "zod";
import { markets } from "./query.js";

const nullableText = z.string().nullable().default(null);
const price = z.number().finite().min(0).max(1e10).nullable().default(null);
export const watchlistDraftSchema = z.object({
  name: z.string().trim().min(1).max(100),
  query: z.string().trim().min(1).max(500),
  domain: z
    .enum(
      Object.keys(markets) as [
        keyof typeof markets,
        ...(keyof typeof markets)[],
      ],
    )
    .default("co.uk"),
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
    .nullable()
    .default(null),
  buying_format: z
    .enum(["auction", "buy_it_now", "best_offer"])
    .nullable()
    .default(null),
  min_price: price,
  max_price: price,
  free_shipping: z.boolean().default(false),
  location: z.enum(["domestic", "worldwide"]).nullable().default(null),
  language: z
    .enum(["english", "japanese", "chinese", "korean"])
    .nullable()
    .default(null),
  interval_minutes: z.number().int().min(1).max(1440).default(2),
  monitor_active: z.boolean().default(false),
  monitor_sold: z.boolean().default(false),
  market_profile: z
    .enum(["chairs", "charizard_psa9_base"])
    .nullable()
    .default(null),
});
const validPrices = (input: {
  min_price: number | null;
  max_price: number | null;
}) =>
  input.min_price === null ||
  input.max_price === null ||
  input.min_price <= input.max_price;
export const watchlistRowSchema = watchlistDraftSchema
  .extend({
    id: z.uuid(),
    telegram_chat_id: z.string().regex(/^-?\d+$/),
    revision: z.number().int().positive(),
    research_requested_at: nullableText,
    created_at: z.string(),
    updated_at: z.string(),
    deleted_at: nullableText,
  })
  .refine(validPrices, "Minimum price exceeds maximum price");
export type WatchlistEntry = z.infer<typeof watchlistRowSchema>;
export type WatchlistDraft = z.input<typeof watchlistDraftSchema>;
export type WatchlistPatch = Partial<z.output<typeof watchlistDraftSchema>> & {
  research_requested_at?: string;
};
export interface WatchlistRepository {
  list(chatId: string): Promise<WatchlistEntry[]>;
  create(
    id: string,
    chatId: string,
    input: WatchlistDraft,
  ): Promise<WatchlistEntry>;
  update(
    id: string,
    chatId: string,
    revision: number,
    patch: WatchlistPatch,
  ): Promise<WatchlistEntry>;
  remove(id: string, chatId: string, revision: number): Promise<void>;
}
const unavailable = () =>
  new Error("Supabase watch list unavailable. Try again shortly.");
const conflict = () =>
  new Error(
    "This watch changed or was removed. Review the watch list and try again.",
  );

export function createWatchlistRepository(
  url: string,
  secretKey: string,
  fetcher: typeof fetch = fetch,
): WatchlistRepository {
  const endpoint = new URL(url);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("Invalid Supabase URL");
  if (!secretKey.startsWith("sb_secret_") && !secretKey.startsWith("eyJ"))
    throw new Error("A server Supabase key is required");
  const client = new PostgrestClient(endpoint.origin + "/rest/v1", {
    headers: {
      apikey: secretKey,
      ...(secretKey.startsWith("eyJ")
        ? { Authorization: `Bearer ${secretKey}` }
        : {}),
    },
    fetch: (input, init) =>
      fetcher(input, { ...init, signal: AbortSignal.timeout(15000) }),
  });
  const owner = (chatId: string) =>
    z
      .string()
      .regex(/^-?\d+$/)
      .parse(chatId);
  const entryId = (id: string) => z.uuid().parse(id);
  async function write(
    id: string,
    chatId: string,
    revision: number,
    patch: object,
  ): Promise<WatchlistEntry> {
    z.number().int().positive().parse(revision);
    let result;
    try {
      result = await client
        .from("ebay_watchlist")
        .update(patch)
        .eq("id", entryId(id))
        .eq("telegram_chat_id", owner(chatId))
        .eq("revision", revision)
        .is("deleted_at", null)
        .select();
    } catch {
      throw unavailable();
    }
    if (result.error) throw unavailable();
    if (!Array.isArray(result.data) || result.data.length !== 1)
      throw conflict();
    const parsed = watchlistRowSchema.safeParse(result.data[0]);
    if (!parsed.success) throw unavailable();
    return parsed.data;
  }
  return {
    async list(chatId) {
      try {
        const { data, error } = await client
          .from("ebay_watchlist")
          .select("*")
          .eq("telegram_chat_id", owner(chatId))
          .is("deleted_at", null)
          .order("created_at")
          .order("id")
          .limit(101);
        if (error) throw unavailable();
        return z.array(watchlistRowSchema).max(100).parse(data);
      } catch {
        throw unavailable();
      }
    },
    async create(id, chatId, input) {
      const parsed = watchlistDraftSchema
        .strict()
        .refine(validPrices)
        .parse(input);
      try {
        const { data, error } = await client
          .from("ebay_watchlist")
          .insert({
            ...parsed,
            id: entryId(id),
            telegram_chat_id: owner(chatId),
          })
          .select()
          .single();
        if (error) {
          if (error.code === "23505") {
            const existing = await client
              .from("ebay_watchlist")
              .select("*")
              .eq("id", id)
              .eq("telegram_chat_id", chatId)
              .is("deleted_at", null)
              .single();
            const row = watchlistRowSchema.parse(existing.data);
            if (
              !existing.error &&
              JSON.stringify(watchlistDraftSchema.parse(row)) ===
                JSON.stringify(parsed)
            )
              return row;
          }
          throw unavailable();
        }
        return watchlistRowSchema.parse(data);
      } catch {
        throw unavailable();
      }
    },
    async update(id, chatId, revision, patch) {
      const parsed = watchlistDraftSchema
        .partial()
        .extend({ research_requested_at: z.iso.datetime().optional() })
        .strict()
        .parse(patch);
      return write(id, chatId, revision, parsed);
    },
    async remove(id, chatId, revision) {
      await write(id, chatId, revision, {
        monitor_active: false,
        monitor_sold: false,
        deleted_at: new Date().toISOString(),
      });
    },
  };
}
