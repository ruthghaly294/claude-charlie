import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sourceHealth, jobRuns } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Connector health dashboard data: per-source circuit breaker state +
 * latency (source_health, written by src/discovery/sourceRunner.ts) and the
 * most recent job execution history (job_runs, written by
 * src/jobs/runner.ts).
 */
export async function GET(): Promise<NextResponse> {
  try {
    const db = getDb();
    return NextResponse.json({
      sourceHealth: db.select().from(sourceHealth).all(),
      recentJobRuns: db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(50).all(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
