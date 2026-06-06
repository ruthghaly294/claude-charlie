import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { queryInsights } from "@/discovery/loopQuery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const rows = queryInsights(getDb());
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
