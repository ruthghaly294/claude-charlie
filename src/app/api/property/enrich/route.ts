import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { enrichAllListings } from "@/property/listings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(): Promise<NextResponse> {
  try {
    const summary = await enrichAllListings(getDb());
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "enrich failed" },
      { status: 500 },
    );
  }
}
