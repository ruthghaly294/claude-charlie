import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { loadConfig } from "@/discovery/config";
import { runDecode } from "@/discovery/runDecode";
import { getReasoner } from "@/discovery/claudeReasoner";
import { UsageMeter } from "@/discovery/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// a full loop with the LLM reasoner can take a while
export const maxDuration = 300;

export async function POST(): Promise<NextResponse> {
  try {
    const db = getDb();
    const config = loadConfig();
    const meter = new UsageMeter();
    const digest = await runDecode(db, config, {
      reasoner: getReasoner(
        {
          businessName: config.businessName,
          businessDescription: config.businessDescription,
          profile: config.profile,
        },
        process.env,
        meter,
      ),
      meter,
    });
    return NextResponse.json(digest);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "decode failed" },
      { status: 500 },
    );
  }
}
