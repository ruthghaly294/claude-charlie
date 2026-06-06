import type { DB } from "@/db/client";
import { insights, decisions, type NewDecision } from "@/db/schema";
import { LANES, type DecodeConfig, type Lane } from "./config";
import {
  deterministicReasoner,
  type Reasoner,
  type Impact,
  type Effort,
} from "./reasoner";

export type DecideSummary = { decisionsWritten: number };

export type DecideOptions = {
  reasoner?: Reasoner;
  now?: () => string;
};

const SCORE: Record<Impact | Effort, number> = { high: 3, medium: 2, low: 1 };

/** impact/effort ratio mapped onto a 1–10 priority scale (higher = do first). */
export function computePriority(impact: Impact, effort: Effort): number {
  const ratio = SCORE[impact] / SCORE[effort];
  return Math.round(ratio * (10 / 3) * 100) / 100;
}

/**
 * DECIDE: turn every insight into a prioritized recommendation. Lane comes from
 * the optional `clusterLanes` config, else round-robins across the four lanes
 * for spread. Idempotent: decision ids are stable (`decision:<insightId>`).
 */
export function runDecide(
  db: DB,
  config: DecodeConfig,
  opts: DecideOptions = {},
): DecideSummary {
  const { reasoner = deterministicReasoner, now = () => new Date().toISOString() } =
    opts;

  const rows = db
    .select()
    .from(insights)
    .all()
    .sort((a, b) => a.id.localeCompare(b.id));

  const createdAt = now();
  let decisionsWritten = 0;

  rows.forEach((insight, i) => {
    const lane: Lane =
      config.clusterLanes[insight.cluster] ??
      LANES[i % LANES.length] ??
      "content";
    const { title, effort, rationale } = reasoner.proposeDecision(insight, lane);
    const impact: Impact = insight.importance;

    const decision: NewDecision = {
      id: `decision:${insight.id}`,
      lane,
      title,
      impact,
      effort,
      priority: computePriority(impact, effort),
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
  });

  return { decisionsWritten };
}
