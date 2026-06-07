import { randomUUID } from "node:crypto";
import { count, desc, eq, ne, type SQL } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  signals,
  insights,
  decisions,
  executions,
  decodeRuns,
  type StageResult,
} from "@/db/schema";
import type { DecodeConfig } from "./config";
import type { Reasoner } from "./reasoner";
import type { Critic } from "./critic";
import type { UsageMeter } from "./usage";
import { runFeedback, type Metric } from "./feedback";
import { runCurate } from "./curate";
import { runObserve } from "./observe";
import { runDecide } from "./decide";
import { runExecute } from "./execute";
import { runPackage } from "./package";

export type DecodeDigest = {
  signals: { kept: number; archived: number };
  insights: { count: number; top: { trend: string; importance: string }[] };
  decisions: {
    count: number;
    top: { title: string; lane: string; priority: number }[];
  };
  executions: { count: number; top: { title: string; lane: string }[] };
};

export type RunDecodeOptions = {
  reasoner?: Reasoner;
  critic?: Critic;
  /** if present, FEEDBACK runs first so CURATE uses the fresh multipliers */
  metrics?: Metric[];
  now?: () => string;
  /** token/cost ledger shared with the reasoner; folded into the run row */
  meter?: UsageMeter;
};

function countSignals(db: DB, where: SQL): number {
  return db.select({ n: count() }).from(signals).where(where).get()?.n ?? 0;
}

async function timed<T>(
  stages: StageResult[],
  stage: string,
  fn: () => Promise<{ count: number }> | { count: number },
): Promise<void> {
  const start = Date.now();
  const out = await fn();
  stages.push({ stage, durationMs: Date.now() - start, count: out.count });
}

/**
 * Run the intelligence loop end-to-end over already-discovered signals:
 * (FEEDBACK?) → CURATE → OBSERVE → DECIDE → EXECUTE, and return a 4-panel
 * digest. Discovery is intentionally separate (it hits the network); this is
 * the reasoning half and is fully deterministic + idempotent.
 */
export async function runDecode(
  db: DB,
  config: DecodeConfig,
  opts: RunDecodeOptions = {},
): Promise<DecodeDigest> {
  const {
    reasoner,
    critic,
    metrics,
    now = () => new Date().toISOString(),
    meter,
  } = opts;
  const stageOpts = { reasoner, now };

  const runId = randomUUID();
  db.insert(decodeRuns)
    .values({ id: runId, startedAt: now(), status: "running" })
    .run();

  const stages: StageResult[] = [];
  try {
    if (metrics && metrics.length > 0) runFeedback(db, metrics);
    await timed(stages, "curate", () => {
      const s = runCurate(db, config);
      return { count: s.kept };
    });
    await timed(stages, "observe", async () => {
      const s = await runObserve(db, config, stageOpts);
      return { count: s.insightsWritten };
    });
    await timed(stages, "decide", async () => {
      const s = await runDecide(db, config, stageOpts);
      return { count: s.decisionsWritten };
    });
    await timed(stages, "execute", async () => {
      const s = await runExecute(db, config, { ...stageOpts, critic });
      return { count: s.executionsWritten };
    });
    await timed(stages, "package", () => {
      const s = runPackage(db, config, { now });
      return { count: s.productsWritten };
    });
  } catch (err) {
    db.update(decodeRuns)
      .set({
        finishedAt: now(),
        status: "error",
        stages,
        error: err instanceof Error ? err.message : String(err),
      })
      .where(eq(decodeRuns.id, runId))
      .run();
    throw err;
  }

  const kept = countSignals(db, ne(signals.status, "archived"));
  const archived = countSignals(db, eq(signals.status, "archived"));

  const insightRows = db
    .select()
    .from(insights)
    .orderBy(desc(insights.createdAt))
    .all();
  const decisionRows = db
    .select()
    .from(decisions)
    .orderBy(desc(decisions.priority))
    .all();
  const executionRows = db
    .select()
    .from(executions)
    .orderBy(desc(executions.createdAt))
    .all();

  const digest: DecodeDigest = {
    signals: { kept, archived },
    insights: {
      count: insightRows.length,
      top: insightRows
        .slice(0, 3)
        .map((r) => ({ trend: r.trend, importance: r.importance })),
    },
    decisions: {
      count: decisionRows.length,
      top: decisionRows
        .slice(0, 3)
        .map((r) => ({ title: r.title, lane: r.lane, priority: r.priority })),
    },
    executions: {
      count: executionRows.length,
      top: executionRows
        .slice(0, 3)
        .map((r) => ({ title: r.title, lane: r.lane })),
    },
  };

  const totals = meter?.totals ?? { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  db.update(decodeRuns)
    .set({
      finishedAt: now(),
      status: "ok",
      stages,
      digest,
      tokensIn: totals.tokensIn,
      tokensOut: totals.tokensOut,
      costUsd: totals.costUsd,
    })
    .where(eq(decodeRuns.id, runId))
    .run();

  return digest;
}
