import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { createDb, getDb } from "@/db/client";
import { trendRuns } from "@/db/schema";
import { loadConfig } from "@/discovery/config";
import {
  runTrendImitation,
  applyTrendOverrides,
  type TrendStage,
  type TrendRunOverrides,
} from "@/publishing/runTrendImitation";
import { buildModeDeps, type TrendRunMode } from "@/publishing/trendModes";
import { applyMediaOverride } from "@/publishing/mediaProvider";
import { resolveModelSelection } from "@/publishing/mediaModels";
import { buildRegistry } from "@/jobs/registry";
import { enqueueJob } from "@/jobs/runner";
import { ensureTrendWorker } from "@/jobs/inProcessWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// demo/dry-run run inline; live is enqueued to the in-process worker (no timeout).
export const maxDuration = 120;

const MODES: TrendRunMode[] = ["demo", "dry-run", "live"];

function resolveAssetStyle(raw: unknown, fallback: "standard" | "infographic"): "standard" | "infographic" {
  return raw === "infographic" || raw === "standard" ? raw : fallback;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Pull the new per-run pipeline knobs out of the request body, ignoring junk. */
function parseTrendOverrides(body: Record<string, unknown>): TrendRunOverrides {
  const o: TrendRunOverrides = {};
  if (body.sourceMode === "generate" || body.sourceMode === "stock" || body.sourceMode === "duet") {
    o.sourceMode = body.sourceMode;
  }
  if (typeof body.captionOverlay === "boolean") o.captionOverlay = body.captionOverlay;
  if (body.viralityScorer === "higgsfield" || body.viralityScorer === "llm") {
    o.viralityScorer = body.viralityScorer;
  }
  if (typeof body.briefVariants === "number" && Number.isFinite(body.briefVariants)) {
    o.briefVariants = Math.max(1, Math.min(5, Math.round(body.briefVariants)));
  }
  if (typeof body.duetSourceUrl === "string" && body.duetSourceUrl.trim()) {
    o.duetSourceUrl = body.duetSourceUrl.trim();
  }
  if (body.promptVariants && typeof body.promptVariants === "object") {
    const sel: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.promptVariants as Record<string, unknown>)) {
      if (typeof v === "string" && v) sel[k] = v;
    }
    if (Object.keys(sel).length > 0) o.promptVariants = sel;
  }
  if (typeof body.manualResearch === "string" && body.manualResearch.trim()) {
    o.manualResearch = body.manualResearch.trim();
  }
  return o;
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: {
    topic?: unknown;
    mode?: unknown;
    assetStyle?: unknown;
    reviewEnabled?: unknown;
    coverModelKey?: unknown;
    coverModelCustom?: unknown;
    videoModelKey?: unknown;
    videoModelCustom?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const mode: TrendRunMode = MODES.includes(body.mode as TrendRunMode)
    ? (body.mode as TrendRunMode)
    : "demo";
  const reviewEnabled = body.reviewEnabled === true;

  if (!topic) return NextResponse.json({ error: "topic is required" }, { status: 400 });

  const coverSelection = resolveModelSelection("image", asString(body.coverModelKey), asString(body.coverModelCustom));
  if (!coverSelection.ok) return NextResponse.json({ error: coverSelection.error }, { status: 400 });
  const videoSelection = resolveModelSelection("video", asString(body.videoModelKey), asString(body.videoModelCustom));
  if (!videoSelection.ok) return NextResponse.json({ error: videoSelection.error }, { status: 400 });
  const coverModel = coverSelection.model;
  const videoModel = videoSelection.model;

  const loaded = loadConfig();
  const assetStyle = resolveAssetStyle(body.assetStyle, loaded.trendImitation.assetStyle);
  const overrides = parseTrendOverrides(body as Record<string, unknown>);

  // Live runs render real media (minutes) — enqueue a job, return a runId immediately,
  // and let the in-process worker drive it so the browser never blocks or times out.
  if (mode === "live") {
    const db = getDb();
    const now = new Date().toISOString();
    const runId = randomUUID();
    db.insert(trendRuns)
      .values({
        id: runId,
        topic,
        mode,
        assetStyle,
        status: "pending",
        stages: [],
        reviewEnabled,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    enqueueJob(db, "trend-imitation", buildRegistry(), {
      payload: { runId, topic, assetStyle, reviewEnabled, coverModel, videoModel, overrides },
    });
    ensureTrendWorker();
    return NextResponse.json({ runId, topic, mode, assetStyle, reviewEnabled, coverModel, videoModel, overrides, async: true });
  }

  // demo/dry-run are fast; run inline and return the full trace. Demo stays in-memory.
  const config = {
    ...loaded,
    trendImitation: applyTrendOverrides(
      applyMediaOverride(loaded.trendImitation, { assetStyle, coverModel, videoModel }),
      overrides,
    ),
  };
  const db = mode === "demo" ? createDb(":memory:") : getDb();
  const stages: { stage: TrendStage; data: unknown }[] = [];
  const deps = buildModeDeps(
    mode,
    config,
    process.env,
    (stage, data) => {
      stages.push({ stage, data });
    },
    db,
  );

  try {
    const result = await runTrendImitation(db, config, topic, deps);
    return NextResponse.json({ topic, mode, assetStyle, stages, result });
  } catch (err) {
    return NextResponse.json(
      { topic, mode, assetStyle, stages, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** GET /api/trend?runId=… → one run's live progress; GET /api/trend → recent runs. */
export async function GET(req: Request): Promise<NextResponse> {
  const db = getDb();
  const runId = new URL(req.url).searchParams.get("runId");
  if (runId) {
    const row = db.select().from(trendRuns).where(eq(trendRuns.id, runId)).get();
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ run: row });
  }
  const runs = db.select().from(trendRuns).orderBy(desc(trendRuns.createdAt)).limit(10).all();
  return NextResponse.json({ runs });
}
