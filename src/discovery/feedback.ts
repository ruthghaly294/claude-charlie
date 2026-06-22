import type { DB } from "@/db/client";
import { rankings, type Ranking } from "@/db/schema";

export type Metric = { keyword: string; value: number };

/**
 * Compute per-keyword multipliers in [0.5, 1.5] via min-max normalisation of the
 * supplied performance metrics, and upsert them into the rankings table.
 * Higher value ⇒ higher multiplier ⇒ that keyword's signals score higher in curate.
 */
export function runFeedback(db: DB, metrics: Metric[]): Ranking[] {
  const clean = metrics.filter(
    (m) => m.keyword.trim() && Number.isFinite(m.value),
  );
  if (clean.length === 0) return [];

  const values = clean.map((m) => m.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const now = new Date().toISOString();

  const rows: Ranking[] = clean.map((m) => ({
    keyword: m.keyword.toLowerCase().trim(),
    multiplier:
      max > min
        ? Math.round((0.5 + (m.value - min) / (max - min)) * 100) / 100
        : 1,
    value: m.value,
    updatedAt: now,
  }));

  for (const r of rows) {
    db.insert(rankings)
      .values(r)
      .onConflictDoUpdate({
        target: rankings.keyword,
        set: {
          multiplier: r.multiplier,
          value: r.value,
          updatedAt: r.updatedAt,
        },
      })
      .run();
  }
  return rows;
}

/** Load keyword→multiplier map from the rankings table (for curate/scoring). */
export function loadMultipliersFromDb(db: DB): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of db.select().from(rankings).all()) {
    out[r.keyword.toLowerCase()] = r.multiplier;
  }
  return out;
}
