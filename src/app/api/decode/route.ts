import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { loadConfig } from "@/discovery/config";
import { runDecode } from "@/discovery/runDecode";
import { getReasoner } from "@/discovery/claudeReasoner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  try {
    const db = getDb();
    const config = loadConfig();
    const digest = await runDecode(db, config, {
      reasoner: getReasoner({
        businessName: config.businessName,
        businessDescription: config.businessDescription,
      }),
    });
    return NextResponse.json(digest);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "decode failed" },
      { status: 500 },
    );
  }
}
