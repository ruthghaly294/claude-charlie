import { eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { decisions, insights, type Decision } from "@/db/schema";
import type { DecodeConfig } from "./config";

export type DecisionLifecycleSummary = {
  expired: number;
  reopened: number;
};

export type DecisionLifecycleOptions = {
  now?: () => string;
};

function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

/** The most recently created insight (from `decision.fromInsights`) that's newer than `baseline`, if any. */
function findNewerInsight(
  db: DB,
  decision: Decision,
  baseline: string,
): { id: string; cluster: string } | null {
  if (decision.fromInsights.length === 0) return null;

  const rows = db
    .select()
    .from(insights)
    .where(inArray(insights.id, decision.fromInsights))
    .all();

  const newer = rows.filter((i) => i.createdAt > baseline);
  if (newer.length === 0) return null;

  newer.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  return { id: newer[0]!.id, cluster: newer[0]!.cluster };
}

/**
 * Expire "open" decisions whose `createdAt + decisions.ttlDays` has passed
 * (persisting `expiresAt` either way), and reopen "done"/"expired" decisions
 * whose source insight has newer activity than the decision's last update,
 * appending an audit note to `rationale`.
 */
export async function runDecisionLifecycle(
  db: DB,
  config: DecodeConfig,
  opts: DecisionLifecycleOptions = {},
): Promise<DecisionLifecycleSummary> {
  const now = opts.now ?? (() => new Date().toISOString());
  const at = now();
  const summary: DecisionLifecycleSummary = { expired: 0, reopened: 0 };

  const all = db.select().from(decisions).all();

  for (const decision of all) {
    if (decision.status === "open") {
      const expiresAt = addDays(decision.createdAt, config.decisions.ttlDays);
      if (at >= expiresAt) {
        db.update(decisions)
          .set({ status: "expired", updatedAt: at, expiresAt })
          .where(eq(decisions.id, decision.id))
          .run();
        summary.expired++;
      } else if (decision.expiresAt !== expiresAt) {
        db.update(decisions).set({ expiresAt }).where(eq(decisions.id, decision.id)).run();
      }
      continue;
    }

    if (decision.status === "done" || decision.status === "expired") {
      const baseline = decision.updatedAt ?? decision.createdAt;
      const newer = findNewerInsight(db, decision, baseline);
      if (newer) {
        const rationale = `${decision.rationale}\n\n[reopened ${at}]: new insight activity in cluster "${newer.cluster}"`;
        db.update(decisions)
          .set({ status: "reopened", updatedAt: at, rationale })
          .where(eq(decisions.id, decision.id))
          .run();
        summary.reopened++;
      }
    }
  }

  return summary;
}
