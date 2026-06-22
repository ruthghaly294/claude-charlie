import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { loadConfig } from "@/discovery/config";
import { scrapeAllAgents } from "@/property/agentScrape";
import { loadSources } from "@/property/sources";
import { getExtractClient } from "@/property/llmExtract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const max = Number(new URL(req.url).searchParams.get("max") ?? 25);
    const config = loadConfig();
    const { extraction, geocode } = config.property;
    const summaries = await scrapeAllAgents(getDb(), {
      max,
      agents: loadSources(config.property.sources),
      extractClient: extraction.llmRepair ? getExtractClient() : null,
      llmRepair: extraction.llmRepair,
      llmMaxPagesPerRun: extraction.llmMaxPagesPerRun,
      geocodeProviders: geocode.providers,
    });
    return NextResponse.json({ agents: summaries });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "scrape failed" },
      { status: 500 },
    );
  }
}
