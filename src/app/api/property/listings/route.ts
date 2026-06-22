import { NextResponse } from "next/server";
import { count } from "drizzle-orm";
import { getDb } from "@/db/client";
import { postcodeValues } from "@/db/schema";
import { rankedListings } from "@/property/listings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const db = getDb();
    const area = new URL(req.url).searchParams.get("area") ?? undefined;
    const refPostcodes =
      db.select({ n: count() }).from(postcodeValues).get()?.n ?? 0;

    // attach coordinates from the postcode reference data (for the map)
    const geo = new Map(
      db
        .select({
          postcode: postcodeValues.postcode,
          lat: postcodeValues.latitude,
          lng: postcodeValues.longitude,
        })
        .from(postcodeValues)
        .all()
        .map((g) => [g.postcode, g]),
    );
    const rows = rankedListings(db, area || undefined).map((r) => {
      const g = geo.get(r.postcode);
      return {
        ...r,
        lat: r.latitude ?? g?.lat ?? null,
        lng: r.longitude ?? g?.lng ?? null,
      };
    });

    return NextResponse.json({
      rows,
      reference: { postcodes: refPostcodes },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
