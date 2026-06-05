import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import {
  querySignals,
  signalsQuerySchema,
  distinctClusters,
} from "@/discovery/signalsQuery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const parsed = signalsQuerySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid query", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const db = getDb();
    const { rows, total } = querySignals(db, parsed.data);
    return NextResponse.json({
      rows,
      total,
      clusters: distinctClusters(db),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
