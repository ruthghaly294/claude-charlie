import { z } from "zod";
import { coordinatesSchema } from "./geo.js";
import { moneySchema } from "../contract.js";
export const facebookListingSchema = z.object({
  id: z.string().regex(/^\d+$/),
  title: z.string().trim().min(1).max(1000),
  url: z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "www.facebook.com" &&
      /^\/marketplace\/item\/\d+\/?$/.test(url.pathname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }),
  image: z.url().nullable(),
  price: moneySchema.nullable(),
  locationName: z.string().nullable(),
  coordinates: coordinatesSchema.nullable(),
  availability: z.enum(["available", "pending", "sold", "unknown"]),
  listedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type FacebookListing = z.infer<typeof facebookListingSchema>;
