import { inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { signals } from "@/db/schema";
import { scoreSignal } from "./scoring";
import { loadMultipliersFromDb } from "./feedback";
import type { DecodeConfig } from "./config";

export type CurateSummary = {
  processed: number;
  kept: number;
  archived: number;
};

/**
 * Re-score every non-finalised signal against the current keywords + feedback
 * multipliers, refresh its cluster, and archive anything below the keep
 * threshold. Idempotent: safe to run repeatedly (e.g. after new feedback).
 */
export function runCurate(db: DB, config: DecodeConfig): CurateSummary {
  const multipliers = loadMultipliersFromDb(db);
  const rows = db
    .select()
    .from(signals)
    .where(inArray(signals.status, ["new", "archived"]))
    .all();

  let kept = 0;
  let archived = 0;

  for (const row of rows) {
    const { score, cluster } = scoreSignal(
      `${row.title} ${row.raw}`,
      config.keywords,
      multipliers,
      row.source,
    );
    const status: "new" | "archived" =
      score >= config.keepThreshold ? "new" : "archived";
    if (status === "archived") archived++;
    else kept++;

    db.update(signals)
      .set({ score, cluster, status })
      .where(inArray(signals.id, [row.id]))
      .run();
  }

  return { processed: rows.length, kept, archived };
}
