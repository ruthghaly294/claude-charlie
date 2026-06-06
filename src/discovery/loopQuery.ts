import { desc, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  insights,
  decisions,
  executions,
  type Insight,
  type Decision,
  type Execution,
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
