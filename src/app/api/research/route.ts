import { NextResponse } from "next/server";
import { z } from "zod";
import { runLast30Days } from "@/research/last30days";
import { rankReport, type RankedItem } from "@/research/rank";
import { markAlreadyPosted } from "@/research/dedup";
import { getDb } from "@/db/client";
import { loadConfig } from "@/discovery/config";
import { loadMultipliersFromDb } from "@/discovery/feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// last30days typically takes 1-2 minutes (longer for non-quick runs)
export const maxDuration = 300;

const bodySchema = z.object({
  topic: z.string().trim().min(2).max(200),
  quick: z.boolean().optional(),
});

// single-flight guard — protects the limited ScrapeCreators credit budget
let inFlight = false;

export async function POST(req: Request): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (inFlight) {
    return NextResponse.json(
      { error: "a research run is already in progress — try again shortly" },
      { status: 409 },
    );
  }

  inFlight = true;
  const startedAt = Date.now();
  try {
    const report = await runLast30Days(parsed.data.topic, { quick: parsed.data.quick });

    const config = loadConfig();
    const db = getDb();
    const multipliers = loadMultipliersFromDb(db);
    const { topPicks: _topPicks, ...ranked } = rankReport(report, {
      keywords: config.keywords,
      multipliers,
      weights: config.research.rankWeights,
      halfLifeDays: config.research.halfLifeDays,
      topN: config.research.topN,
    });

    const itemsBySource: Record<string, (RankedItem & { alreadyPosted: boolean })[]> = {};
    const allAnnotated: (RankedItem & { alreadyPosted: boolean })[] = [];
    for (const [source, items] of Object.entries(ranked.itemsBySource)) {
      const annotated = markAlreadyPosted(items, db);
      itemsBySource[source] = annotated;
      allAnnotated.push(...annotated);
    }

    const topPicks = allAnnotated
      .filter((item) => !item.alreadyPosted)
      .sort((a, b) => b.score - a.score)
      .slice(0, config.research.topN);

    return NextResponse.json({
      report: { ...ranked, itemsBySource },
      topPicks,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "research failed" },
      { status: 500 },
    );
  } finally {
    inFlight = false;
  }
}
