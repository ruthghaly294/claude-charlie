import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { queryDecisions } from "@/discovery/loopQuery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const rows = queryDecisions(getDb());
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
