import { and, count, desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  insights,
  decisions,
  executions,
  decodeRuns,
  products,
  type Insight,
  type Decision,
  type Execution,
  type DecodeRun,
  type Product,
} from "@/db/schema";

const DEFAULT_LIMIT = 50;

/** Insights, most important first (high → low), then most recent. */
export function queryInsights(db: DB, limit = DEFAULT_LIMIT): Insight[] {
  return db
    .select()
    .from(insights)
    .orderBy(
      sql`case ${insights.importance} when 'high' then 0 when 'medium' then 1 else 2 end`,
      desc(insights.createdAt),
    )
    .limit(limit)
    .all();
}

/** Decisions, highest priority first. */
export function queryDecisions(db: DB, limit = DEFAULT_LIMIT): Decision[] {
  return db
    .select()
    .from(decisions)
    .orderBy(desc(decisions.priority))
    .limit(limit)
    .all();
}

/** Execution drafts, most recent first. */
export function queryExecutions(db: DB, limit = DEFAULT_LIMIT): Execution[] {
  return db
    .select()
    .from(executions)
    .orderBy(desc(executions.createdAt))
    .limit(limit)
    .all();
}

/** Content-lane executions ready for review (drafted, quality-gated, not yet queued). */
export function queryContentQueue(db: DB, limit = DEFAULT_LIMIT): Execution[] {
  return db
    .select()
    .from(executions)
    .where(and(eq(executions.status, "ready"), eq(executions.lane, "content")))
    .orderBy(desc(executions.createdAt))
    .limit(limit)
    .all();
}

/** Count of content-lane executions ready for review (for pipeline-health badges). */
export function countContentQueue(db: DB): number {
  return (
    db
      .select({ c: count() })
      .from(executions)
      .where(and(eq(executions.status, "ready"), eq(executions.lane, "content")))
      .get()?.c ?? 0
  );
}

/** Sellable products, most recent first. */
export function queryProducts(db: DB, limit = DEFAULT_LIMIT): Product[] {
  return db
    .select()
    .from(products)
    .orderBy(desc(products.createdAt))
    .limit(limit)
    .all();
}

/** DECODE loop runs, most recent first (history + cost ledger). */
export function queryRuns(db: DB, limit = DEFAULT_LIMIT): DecodeRun[] {
  return db
    .select()
    .from(decodeRuns)
    .orderBy(desc(decodeRuns.startedAt))
    .limit(limit)
    .all();
}

/** Latest run (for the Command Center / pipeline health). */
export function latestRun(db: DB): DecodeRun | undefined {
  return queryRuns(db, 1)[0];
}

/** Total spend across all recorded runs. */
export function totalSpend(db: DB): {
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
} {
  const row = db
    .select({
      costUsd: sql<number>`coalesce(sum(${decodeRuns.costUsd}), 0)`,
      tokensIn: sql<number>`coalesce(sum(${decodeRuns.tokensIn}), 0)`,
      tokensOut: sql<number>`coalesce(sum(${decodeRuns.tokensOut}), 0)`,
    })
    .from(decodeRuns)
    .get();
  return {
    costUsd: row?.costUsd ?? 0,
    tokensIn: row?.tokensIn ?? 0,
    tokensOut: row?.tokensOut ?? 0,
  };
}
