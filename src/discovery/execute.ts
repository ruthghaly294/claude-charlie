import { desc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { decisions, executions, type NewExecution } from "@/db/schema";
import type { DecodeConfig } from "./config";
import { deterministicReasoner, type Reasoner } from "./reasoner";

export type ExecuteSummary = { executionsWritten: number };

export type ExecuteOptions = {
  reasoner?: Reasoner;
  now?: () => string;
};

/**
 * EXECUTE: draft an asset for the top-N open decisions (by priority), then mark
 * those decisions done. Drafts only — nothing is published. Idempotent:
 * execution ids are stable (`exec:<decisionId>`) and only "open" decisions are
 * picked, so a second run with no new decisions is a no-op.
 */
export function runExecute(
  db: DB,
  config: DecodeConfig,
  opts: ExecuteOptions = {},
): ExecuteSummary {
  const { reasoner = deterministicReasoner, now = () => new Date().toISOString() } =
    opts;

  const top = db
    .select()
    .from(decisions)
    .where(eq(decisions.status, "open"))
    .orderBy(desc(decisions.priority))
    .limit(config.topN)
    .all();

  if (top.length === 0) return { executionsWritten: 0 };

  const createdAt = now();
  for (const decision of top) {
    const { title, body } = reasoner.draftAsset(decision);
    const execution: NewExecution = {
      id: `exec:${decision.id}`,
      decisionId: decision.id,
      lane: decision.lane,
      title,
      body,
      status: "draft",
      createdAt,
    };
    db.insert(executions)
      .values(execution)
      .onConflictDoUpdate({
        target: executions.id,
        set: { title: execution.title, body: execution.body },
      })
      .run();
  }

  db.update(decisions)
    .set({ status: "done" })
    .where(
      inArray(
        decisions.id,
        top.map((d) => d.id),
      ),
    )
    .run();

  return { executionsWritten: top.length };
}
