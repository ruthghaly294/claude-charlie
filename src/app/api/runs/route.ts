import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { queryRuns, totalSpend } from "@/discovery/loopQuery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const db = getDb();
    return NextResponse.json({ rows: queryRuns(db, 50), spend: totalSpend(db) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
