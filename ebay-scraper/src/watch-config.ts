import { z } from "zod";
import { markets } from "./query.js";
export const watchSchema = z.strictObject({
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
  mode: z.enum(["active", "sold"]),
  intervalMinutes: z.number().int().min(1).max(1440).default(2),
  marketProfile: z.enum(["chairs", "charizard_psa9_base"]).optional(),
  watchlistId: z.uuid().optional(),
  researchRequest: z.string().optional(),
  once: z.boolean().optional(),
  notifyNew: z.boolean().optional(),
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
  buyingFormat: z.enum(["auction", "buy_it_now", "best_offer"]).optional(),
  minPrice: z.number().finite().min(0).max(1e10).optional(),
  freeShipping: z.boolean().optional(),
  location: z.enum(["domestic", "worldwide"]).optional(),
  language: z.enum(["english", "japanese", "chinese", "korean"]).optional(),
  maxPrice: z.number().finite().min(0).max(1e10).optional(),
});
export type WatchInput = z.infer<typeof watchSchema>;
