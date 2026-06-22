import { describe, it, expect } from "vitest";
import {
  QOTD_SUBTOPIC_ORDER,
  emptyScheduleState,
  subtopicForRun,
  decideRun,
  recordRun,
} from "./qotdSchedule";

describe("qotd schedule rotation", () => {
  it("starts at X-ray physics and cycles the fixed order", () => {
    expect(subtopicForRun(0)).toBe("X-ray physics");
    expect(subtopicForRun(1)).toBe("CT physics");
    expect(subtopicForRun(7)).toBe("Radiation safety");
    expect(subtopicForRun(8)).toBe("X-ray physics"); // wraps
    expect(QOTD_SUBTOPIC_ORDER).toHaveLength(8);
  });

  it("runs once per day, advancing the subtopic per successful run", () => {
    let state = emptyScheduleState("2026-06-22");

    const d1 = decideRun(state, "2026-06-22", 30);
    expect(d1).toEqual({ run: true, runIndex: 0, subtopic: "X-ray physics" });
    state = recordRun(state, "2026-06-22");

    // Same day again → idempotent skip.
    expect(decideRun(state, "2026-06-22", 30)).toMatchObject({ run: false, reason: "already-ran-today" });

    // Next day → next subtopic.
    const d2 = decideRun(state, "2026-06-23", 30);
    expect(d2).toEqual({ run: true, runIndex: 1, subtopic: "CT physics" });
  });

  it("a missed day never skips a subtopic (rotation tracks runs, not the calendar)", () => {
    let state = emptyScheduleState("2026-06-22");
    state = recordRun(state, "2026-06-22"); // ran X-ray
    // skip 2026-06-23 entirely; next trigger is 2026-06-24
    const d = decideRun(state, "2026-06-24", 30);
    expect(d).toEqual({ run: true, runIndex: 1, subtopic: "CT physics" });
  });

  it("stops after the configured number of runs", () => {
    const state = { startDate: "2026-06-22", lastRunDate: "2026-07-21", runsCompleted: 30, usedStatements: [] };
    expect(decideRun(state, "2026-07-22", 30)).toMatchObject({ run: false, reason: "schedule-complete" });
  });

  it("accumulates used statements across runs without duplicates", () => {
    let state = emptyScheduleState("2026-06-22");
    state = recordRun(state, "2026-06-22", ["s1", "s2"]);
    expect(state.usedStatements).toEqual(["s1", "s2"]);
    state = recordRun(state, "2026-06-23", ["s2", "s3"]); // s2 repeats — must not duplicate
    expect(state.usedStatements).toEqual(["s1", "s2", "s3"]);
    expect(state.runsCompleted).toBe(2);
  });
});
