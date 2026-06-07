import { eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { signals, insights, type Signal, type NewInsight } from "@/db/schema";
import type { DecodeConfig } from "./config";
import { deterministicReasoner, type Reasoner } from "./reasoner";

export type ObserveSummary = {
  clustersObserved: number;
  insightsWritten: number;
  signalsObserved: number;
};

export type ObserveOptions = {
  reasoner?: Reasoner;
  now?: () => string;
};

/**
 * OBSERVE: group kept ("new") signals by cluster, distill each qualifying
 * cluster into one insight, and promote the observed signals to "curated" so
 * re-runs don't reprocess them. Idempotent: insight ids are stable per cluster
 * (`insight:<cluster>`), so a cluster that grows is updated, not duplicated.
 */
export async function runObserve(
  db: DB,
  config: DecodeConfig,
  opts: ObserveOptions = {},
): Promise<ObserveSummary> {
  const { reasoner = deterministicReasoner, now = () => new Date().toISOString() } =
    opts;

  const rows = db
    .select()
    .from(signals)
    .where(eq(signals.status, "new"))
    .all();

  const byCluster = new Map<string, Signal[]>();
  for (const row of rows) {
    const cluster = row.cluster ?? "unclustered";
    if (cluster === "unclustered") continue;
    const list = byCluster.get(cluster) ?? [];
    list.push(row);
    byCluster.set(cluster, list);
  }

  let insightsWritten = 0;
  let signalsObserved = 0;
  const createdAt = now();

  for (const [cluster, clusterSignals] of byCluster) {
    if (clusterSignals.length < config.minClusterSize) continue;

    const { trend, body, importance } = await reasoner.summarizeCluster(
      cluster,
      clusterSignals,
    );
    const insight: NewInsight = {
      id: `insight:${cluster}`,
      cluster,
      trend,
      importance,
      body,
      evidence: clusterSignals.map((s) => s.id),
      createdAt,
    };
    db.insert(insights)
      .values(insight)
      .onConflictDoUpdate({
        target: insights.id,
        set: {
          trend: insight.trend,
          importance: insight.importance,
          body: insight.body,
          evidence: insight.evidence,
          createdAt: insight.createdAt,
        },
      })
      .run();
    insightsWritten++;

    const ids = clusterSignals.map((s) => s.id);
    db.update(signals)
      .set({ status: "curated" })
      .where(inArray(signals.id, ids))
      .run();
    signalsObserved += ids.length;
  }

  return {
    clustersObserved: insightsWritten,
    insightsWritten,
    signalsObserved,
  };
}
