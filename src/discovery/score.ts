export type Level = "high" | "medium" | "low";

export type ScoreInputs = {
  impact: Level;
  confidence: Level;
  effort: Level;
  /** expected revenue per month from acting on this, in dollars */
  valuePerMonth: number;
};

const LEVEL_N: Record<Level, number> = { high: 3, medium: 2, low: 1 };

/** Bucket expected $/mo into a 1–3 value factor. */
export function valueScore(valuePerMonth: number): number {
  if (valuePerMonth >= 1000) return 3;
  if (valuePerMonth >= 200) return 2;
  return 1;
}

/** Rough hours an effort level implies — the "time" dimension for the queue. */
const EFFORT_HOURS: Record<Level, number> = { high: 16, medium: 6, low: 2 };
export function effortHours(effort: Level): number {
  return EFFORT_HOURS[effort];
}

/**
 * RICE/ICE-style priority on a readable 1–100 scale:
 * (impact × confidence × value) / effort, normalised against the max (27).
 * Higher = more worth your attention, time, and tokens.
 */
export function priorityScore(i: ScoreInputs): number {
  const raw =
    (LEVEL_N[i.impact] * LEVEL_N[i.confidence] * valueScore(i.valuePerMonth)) /
    LEVEL_N[i.effort];
  return Math.max(1, Math.round((raw / 27) * 100));
}
