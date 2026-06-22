import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { loadConfig } from "@/discovery/config";
import { runDiscovery } from "@/discovery/runDiscovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// a discovery run hits several external APIs; give it headroom
export const maxDuration = 60;

export async function POST(): Promise<NextResponse> {
  try {
    const db = getDb();
    const config = loadConfig();
    const summary = await runDiscovery(db, config, { writeVault: true });
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "discovery failed" },
      { status: 500 },
    );
  }
}
