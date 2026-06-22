/**
 * Deterministic daily rotation for the hands-off Question-of-the-Day schedule.
 * One carousel draft per calendar day, cycling subtopics in a fixed order
 * (starting at X-ray physics, "working down"), capped at a total number of runs.
 * The subtopic advances per SUCCESSFUL run (not per calendar day) so a missed day
 * never skips a subtopic; a per-day guard keeps it idempotent if triggered twice.
 */
export const QOTD_SUBTOPIC_ORDER = [
  "X-ray physics",
  "CT physics",
  "MRI physics",
  "Ultrasound physics",
  "Nuclear medicine physics",
  "Fluoroscopy physics",
  "Basic radiation science",
  "Radiation safety",
] as const;

export type QotdScheduleState = {
  /** YYYY-MM-DD the schedule began (for reference/logging). */
  startDate: string;
  /** YYYY-MM-DD of the last successful draft (per-day idempotency guard). */
  lastRunDate: string | null;
  /** Count of successful drafts so far; also the rotation cursor. */
  runsCompleted: number;
  /**
   * Verbatim statement texts already drafted. Persisted because the runner re-imports
   * questions from Supabase each run (regenerating row ids), so statement text is the
   * only stable key for stopping the LRU rotation from repeating questions.
   */
  usedStatements: string[];
};

export type ScheduleDecision =
  | { run: false; reason: "already-ran-today" | "schedule-complete"; runIndex: number }
  | { run: true; runIndex: number; subtopic: string };

export function emptyScheduleState(today: string): QotdScheduleState {
  return { startDate: today, lastRunDate: null, runsCompleted: 0, usedStatements: [] };
}

/** Subtopic for the Nth run (0-based), cycling the fixed order. */
export function subtopicForRun(runIndex: number, order: readonly string[] = QOTD_SUBTOPIC_ORDER): string {
  const n = order.length;
  return order[((runIndex % n) + n) % n]!;
}

/**
 * Decide whether to generate a draft now. Stops after `totalRuns`, skips if a
 * draft already ran `today` (YYYY-MM-DD), otherwise returns the next subtopic.
 */
export function decideRun(
  state: QotdScheduleState,
  today: string,
  totalRuns: number,
  order: readonly string[] = QOTD_SUBTOPIC_ORDER,
): ScheduleDecision {
  if (state.runsCompleted >= totalRuns) {
    return { run: false, reason: "schedule-complete", runIndex: state.runsCompleted };
  }
  if (state.lastRunDate === today) {
    return { run: false, reason: "already-ran-today", runIndex: state.runsCompleted };
  }
  return { run: true, runIndex: state.runsCompleted, subtopic: subtopicForRun(state.runsCompleted, order) };
}

/** Advance state after a successful draft, recording the statements it consumed. */
export function recordRun(
  state: QotdScheduleState,
  today: string,
  usedStatements: readonly string[] = [],
): QotdScheduleState {
  const merged = [...new Set([...state.usedStatements, ...usedStatements])];
  return {
    ...state,
    lastRunDate: today,
    runsCompleted: state.runsCompleted + 1,
    usedStatements: merged,
  };
}
