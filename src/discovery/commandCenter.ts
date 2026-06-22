import { count } from "drizzle-orm";
import type { DB } from "@/db/client";
import { signals, insights, decisions, executions } from "@/db/schema";
import { queryDecisions, latestRun, totalSpend, countContentQueue } from "./loopQuery";
import { effortHours, type Level } from "./score";

export type Action = {
  id: string;
  title: string;
  lane: string;
  priority: number;
  valuePerMonth: number;
  effort: string;
  effortHours: number;
  confidence: string;
  status: string;
  rationale: string;
};

export type CommandCenter = {
  focusToday: Action[];
  topActions: Action[];
  spend: {
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
    budgetUsd: number;
    pct: number;
  };
  lastRun: {
    status: string;
    finishedAt: string | null;
    costUsd: number;
    stages: { stage: string; durationMs: number; count: number }[];
  } | null;
  counts: {
    signals: number;
    insights: number;
    decisions: number;
    executions: number;
    /** Ready, content-lane executions awaiting review in the Content queue. */
    contentQueue: number;
  };
};

function n(db: DB, table: typeof signals | typeof insights | typeof decisions | typeof executions): number {
  return db.select({ c: count() }).from(table).get()?.c ?? 0;
}

/**
 * The "where do I point attention/time/tokens" view: open decisions ranked by
 * priority (with the effort-hours + $/mo each implies), spend vs. budget, and
 * pipeline health. Pure read over the DB — safe to call on every request.
 */
export function getCommandCenter(
  db: DB,
  env: Record<string, string | undefined> = process.env,
): CommandCenter {
  const ranked = queryDecisions(db, 50).map(
    (d): Action => ({
      id: d.id,
      title: d.title,
      lane: d.lane,
      priority: d.priority,
      valuePerMonth: d.value,
      effort: d.effort,
      effortHours: effortHours(d.effort as Level),
      confidence: d.confidence,
      // "done" = a draft exists for it (ready to ship), not "completed"
      status: d.status === "done" ? "drafted" : d.status,
      rationale: d.rationale,
    }),
  );

  const spend = totalSpend(db);
  const budgetUsd = Number(env.DECODE_BUDGET_USD ?? 20);
  const run = latestRun(db);

  return {
    focusToday: ranked.slice(0, 3),
    topActions: ranked.slice(0, 8),
    spend: {
      ...spend,
      budgetUsd,
      pct: budgetUsd > 0 ? Math.round((spend.costUsd / budgetUsd) * 100) : 0,
    },
    lastRun: run
      ? {
          status: run.status,
          finishedAt: run.finishedAt,
          costUsd: run.costUsd,
          stages: run.stages,
        }
      : null,
    counts: {
      signals: n(db, signals),
      insights: n(db, insights),
      decisions: n(db, decisions),
      executions: n(db, executions),
      contentQueue: countContentQueue(db),
    },
  };
}
