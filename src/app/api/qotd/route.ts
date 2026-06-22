import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { examQuestions } from "@/db/schema";
import { loadConfig } from "@/discovery/config";
import { runQotdCarousel } from "@/publishing/runQotd";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Render + R2 host + Buffer draft is fast (no AI video), but allow headroom.
export const maxDuration = 120;

/** Content pillars + how many verified statements are imported per subtopic. */
export async function GET(): Promise<NextResponse> {
  const db = getDb();
  const config = loadConfig();
  const counts = db
    .select({ subtopic: examQuestions.subtopic, n: sql<number>`count(*)` })
    .from(examQuestions)
    .groupBy(examQuestions.subtopic)
    .all();
  const available: Record<string, number> = {};
  for (const c of counts) available[c.subtopic] = Number(c.n);
  return NextResponse.json({
    pillars: config.trendImitation.brand.contentPillars,
    available,
    total: counts.reduce((a, c) => a + Number(c.n), 0),
  });
}

/** Generate a Question-of-the-Day carousel — preview (no publish) or create a Buffer draft. */
export async function POST(req: Request): Promise<NextResponse> {
  let body: { subtopic?: unknown; count?: unknown; preview?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body = defaults */
  }
  const subtopic = typeof body.subtopic === "string" && body.subtopic.trim() ? body.subtopic.trim() : undefined;
  const count = typeof body.count === "number" && body.count >= 1 && body.count <= 8 ? Math.floor(body.count) : undefined;
  const preview = body.preview !== false; // default to safe preview

  try {
    const res = await runQotdCarousel(getDb(), loadConfig(), process.env, {
      subtopic,
      count,
      publish: !preview,
    });
    return NextResponse.json({
      ok: true,
      preview,
      subtopic: res.subtopic,
      caption: res.caption,
      slideUrls: res.slideUrls,
      status: res.status,
      bufferPostId: res.bufferPostId,
      videoId: res.videoId,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
