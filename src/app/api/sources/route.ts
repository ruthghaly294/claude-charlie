import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { loadConfig } from "@/discovery/config";
import { listSources, getLatestRun } from "@/discovery/signalsQuery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const db = getDb();
    const config = loadConfig();
    return NextResponse.json({
      business: { name: config.businessName, keywords: config.keywords },
      sources: listSources(db, config),
      latestRun: getLatestRun(db) ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
