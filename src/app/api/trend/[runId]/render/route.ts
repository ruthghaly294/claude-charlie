import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { trendRuns } from "@/db/schema";
import { buildRegistry } from "@/jobs/registry";
import { enqueueJob } from "@/jobs/runner";
import { ensureTrendWorker } from "@/jobs/inProcessWorker";
import type { RenderContext } from "@/publishing/runTrendImitation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resume a paused (`status="awaiting_review"`) run: optionally apply operator
 * edits to the cover/video prompts, then enqueue the render phase. The render
 * job re-reads `render_context` off the row, so edits must land in the DB
 * before the job is enqueued.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  let body: { coverPrompt?: unknown; videoPrompt?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const { runId } = await params;
  const db = getDb();
  const row = db.select().from(trendRuns).where(eq(trendRuns.id, runId)).get();
  if (!row) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (row.status !== "awaiting_review") {
    return NextResponse.json({ error: `run is not awaiting review (status=${row.status})` }, { status: 409 });
  }

  const ctx = row.renderContext as RenderContext | null;
  if (!ctx) return NextResponse.json({ error: "run has no render context" }, { status: 409 });

  const edited: RenderContext = {
    ...ctx,
    coverPrompt:
      typeof body.coverPrompt === "string" && body.coverPrompt.trim() ? body.coverPrompt : ctx.coverPrompt,
    videoPrompt:
      typeof body.videoPrompt === "string" && body.videoPrompt.trim() ? body.videoPrompt : ctx.videoPrompt,
  };

  db.update(trendRuns)
    .set({ renderContext: edited as unknown as Record<string, unknown>, updatedAt: new Date().toISOString() })
    .where(eq(trendRuns.id, runId))
    .run();

  enqueueJob(db, "trend-imitation", buildRegistry(), { payload: { runId, phase: "render" } });
  ensureTrendWorker();

  return NextResponse.json({
    runId,
    status: "rendering",
    coverPrompt: edited.coverPrompt,
    videoPrompt: edited.videoPrompt,
  });
}
