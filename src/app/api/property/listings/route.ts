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
    return NextResponse.json({
      rows: rankedListings(db, area || undefined),
      reference: { postcodes: refPostcodes },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
