import { count, desc, eq, ne, type SQL } from "drizzle-orm";
import type { DB } from "@/db/client";
import { signals, insights, decisions, executions } from "@/db/schema";
import type { DecodeConfig } from "./config";
import type { Reasoner } from "./reasoner";
import { runFeedback, type Metric } from "./feedback";
import { runCurate } from "./curate";
import { runObserve } from "./observe";
import { runDecide } from "./decide";
import { runExecute } from "./execute";

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
  /** if present, FEEDBACK runs first so CURATE uses the fresh multipliers */
  metrics?: Metric[];
  now?: () => string;
};

function countSignals(db: DB, where: SQL): number {
  return db.select({ n: count() }).from(signals).where(where).get()?.n ?? 0;
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
  const { reasoner, metrics, now } = opts;
  const stageOpts = { reasoner, now };

  if (metrics && metrics.length > 0) runFeedback(db, metrics);
  runCurate(db, config);
  await runObserve(db, config, stageOpts);
  await runDecide(db, config, stageOpts);
  await runExecute(db, config, stageOpts);

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

  return {
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
}
