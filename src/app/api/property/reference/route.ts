import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { ingestReference } from "@/property/referenceIngest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(): Promise<NextResponse> {
  try {
    const summary = await ingestReference(getDb());
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "reference ingest failed" },
      { status: 500 },
    );
  }
}
