import type { DB } from "@/db/client";
import { insights, decisions, type NewDecision } from "@/db/schema";
import { LANES, type DecodeConfig, type Lane } from "./config";
import { deterministicReasoner, type Reasoner, type Impact } from "./reasoner";
import { priorityScore } from "./score";

export type DecideSummary = { decisionsWritten: number };

export type DecideOptions = {
  reasoner?: Reasoner;
  now?: () => string;
};

/**
 * DECIDE: turn every insight into a prioritized recommendation. Lane comes from
 * the optional `clusterLanes` config, else round-robins across the four lanes
 * for spread. Idempotent: decision ids are stable (`decision:<insightId>`).
 */
export async function runDecide(
  db: DB,
  config: DecodeConfig,
  opts: DecideOptions = {},
): Promise<DecideSummary> {
  const { reasoner = deterministicReasoner, now = () => new Date().toISOString() } =
    opts;

  const rows = db
    .select()
    .from(insights)
    .all()
    .sort((a, b) => a.id.localeCompare(b.id));

  const createdAt = now();
  let decisionsWritten = 0;

  for (let i = 0; i < rows.length; i++) {
    const insight = rows[i]!;
    const lane: Lane =
      config.clusterLanes[insight.cluster] ??
      LANES[i % LANES.length] ??
      "content";
    const { title, effort, confidence, valuePerMonth, rationale } =
      await reasoner.proposeDecision(insight, lane);
    const impact: Impact = insight.importance;

    const decision: NewDecision = {
      id: `decision:${insight.id}`,
      lane,
      title,
      impact,
      effort,
      confidence,
      value: valuePerMonth,
      priority: priorityScore({ impact, confidence, effort, valuePerMonth }),
      rationale,
      fromInsights: [insight.id],
      status: "open",
      createdAt,
    };
    db.insert(decisions)
      .values(decision)
      .onConflictDoUpdate({
        target: decisions.id,
        set: {
          lane: decision.lane,
          title: decision.title,
          impact: decision.impact,
          effort: decision.effort,
          priority: decision.priority,
          rationale: decision.rationale,
          fromInsights: decision.fromInsights,
        },
      })
      .run();
    decisionsWritten++;
  }

  return { decisionsWritten };
}
