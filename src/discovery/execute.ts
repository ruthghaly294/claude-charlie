import { desc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { decisions, executions, type NewExecution } from "@/db/schema";
import type { DecodeConfig } from "./config";
import { deterministicReasoner, type Reasoner } from "./reasoner";
import { neutralCritic, type Critic } from "./critic";

export type ExecuteSummary = { executionsWritten: number; readyCount: number };

export type ExecuteOptions = {
  reasoner?: Reasoner;
  critic?: Critic;
  now?: () => string;
};

/**
 * EXECUTE: draft an asset for the top-N open decisions (by priority), run each
 * draft through the quality gate, and mark those decisions done. Drafts scoring
 * at/above config.qualityThreshold become "ready" (sellable); the rest stay
 * "draft". Idempotent: execution ids are stable (`exec:<decisionId>`) and only
 * "open" decisions are picked, so a second run with no new decisions is a no-op.
 */
export async function runExecute(
  db: DB,
  config: DecodeConfig,
  opts: ExecuteOptions = {},
): Promise<ExecuteSummary> {
  const {
    reasoner = deterministicReasoner,
    critic = neutralCritic,
    now = () => new Date().toISOString(),
  } = opts;

  const top = db
    .select()
    .from(decisions)
    .where(eq(decisions.status, "open"))
    .orderBy(desc(decisions.priority))
    .limit(config.topN)
    .all();

  if (top.length === 0) return { executionsWritten: 0, readyCount: 0 };

  const createdAt = now();
  let readyCount = 0;
  for (const decision of top) {
    const { title, body } = await reasoner.draftAsset(decision);
    const review = await critic.scoreDraft({ title, body, lane: decision.lane });
    const status = review.score >= config.qualityThreshold ? "ready" : "draft";
    if (status === "ready") readyCount++;
    const execution: NewExecution = {
      id: `exec:${decision.id}`,
      decisionId: decision.id,
      lane: decision.lane,
      title,
      body,
      status,
      qualityScore: review.score,
      qualityNotes: review.notes,
      createdAt,
    };
    db.insert(executions)
      .values(execution)
      .onConflictDoUpdate({
        target: executions.id,
        set: {
          title: execution.title,
          body: execution.body,
          status,
          qualityScore: review.score,
          qualityNotes: review.notes,
        },
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

  return { executionsWritten: top.length, readyCount };
}
