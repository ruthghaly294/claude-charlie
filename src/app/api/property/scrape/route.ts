import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { scrapeAllAgents } from "@/property/agentScrape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const max = Number(new URL(req.url).searchParams.get("max") ?? 25);
    const summaries = await scrapeAllAgents(getDb(), { max });
    return NextResponse.json({ agents: summaries });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "scrape failed" },
      { status: 500 },
    );
  }
}
