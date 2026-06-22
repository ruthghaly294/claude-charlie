import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { importListingEnriched } from "@/property/listings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const listingSchema = z.object({
  address: z.string().min(1),
  postcode: z.string().min(2),
  askingPrice: z.coerce.number().positive(),
  street: z.string().optional(),
  propertyType: z.string().optional(),
  beds: z.coerce.number().int().optional(),
  sizeSqm: z.coerce.number().positive().optional(),
  url: z.string().optional(),
  hasGarage: z.boolean().optional(),
  hasGarden: z.boolean().optional(),
  status: z.enum(["active", "sstc", "sold", "gone"]).optional(),
});

const bodySchema = z.union([listingSchema, z.array(listingSchema)]);

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid listing", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const db = getDb();
    const inputs = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
    const saved = [];
    for (const i of inputs) saved.push(await importListingEnriched(db, i));
    return NextResponse.json({ imported: saved.length, listings: saved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "import failed" },
      { status: 500 },
    );
  }
}
