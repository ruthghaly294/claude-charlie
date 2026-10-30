import { PostgrestClient } from "@supabase/postgrest-js";
import { z } from "zod";
import { fuelSchema } from "./listing.js";

export const carDraftSchema = z.object({
  make: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(40),
  fuel: fuelSchema.nullable(),
  max_age_years: z.number().int().min(1).max(20),
});
export const carWatchSchema = carDraftSchema.extend({
  id: z.uuid(),
  telegram_chat_id: z.string(),
  alerts_active: z.boolean(),
  created_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type CarDraft = z.infer<typeof carDraftSchema>;
export type CarWatch = z.infer<typeof carWatchSchema>;

export interface CarWatchlist {
  list(chatId: string): Promise<CarWatch[]>;
  create(id: string, chatId: string, draft: CarDraft): Promise<CarWatch>;
  update(
    id: string,
    chatId: string,
    patch: { alerts_active: boolean },
  ): Promise<void>;
  remove(id: string, chatId: string): Promise<void>;
}

const unavailable = () => new Error("Car list unavailable. Try again shortly.");

export function createCarWatchlist(
  url: string,
  secretKey: string,
  fetcher: typeof fetch = fetch,
): CarWatchlist {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password)
    throw new Error("Invalid Supabase URL");
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
  const change = async (id: string, chatId: string, patch: object) => {
    const { error } = await client
      .from("car_watchlist")
      .update(patch)
      .eq("id", z.uuid().parse(id))
      .eq("telegram_chat_id", owner(chatId))
      .is("deleted_at", null);
    if (error) throw unavailable();
  };
  return {
    async list(chatId) {
      const { data, error } = await client
        .from("car_watchlist")
        .select("*")
        .eq("telegram_chat_id", owner(chatId))
        .is("deleted_at", null)
        .order("created_at")
        .limit(50);
      if (error) throw unavailable();
      return z.array(carWatchSchema).parse(data);
    },
    async create(id, chatId, draft) {
      const parsed = carDraftSchema.strict().parse(draft);
      const { data, error } = await client
        .from("car_watchlist")
        .insert({
          ...parsed,
          id: z.uuid().parse(id),
          telegram_chat_id: owner(chatId),
        })
        .select()
        .single();
      if (error) throw unavailable();
      return carWatchSchema.parse(data);
    },
    update: (id, chatId, patch) =>
      change(
        id,
        chatId,
        z.object({ alerts_active: z.boolean() }).strict().parse(patch),
      ),
    remove: (id, chatId) =>
      change(id, chatId, {
        alerts_active: false,
        deleted_at: new Date().toISOString(),
      }),
  };
}
