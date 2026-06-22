import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/db/client";
import {
  parseQuestions,
  insertQuestions,
  pickNextForRotation,
  pickNextSet,
  balanceByAnswer,
  markUsed,
  markUsedByStatements,
  type ExamQuestionInput,
} from "./examQuestions";
import type { ExamQuestion } from "@/db/schema";

const SAMPLE: ExamQuestionInput = {
  subtopic: "MRI physics",
  statement: "T1 is the longitudinal relaxation time.",
  correctAnswer: true,
  explanation: "T1 describes recovery of longitudinal magnetisation.",
  difficulty: "Easy",
  source: "question_bank:abc",
};

function withStatement(s: string, subtopic = "MRI physics"): ExamQuestionInput {
  return { ...SAMPLE, statement: s, subtopic };
}

describe("examQuestions repository", () => {
  let db: DB;
  beforeEach(() => {
    db = createDb(":memory:");
  });

  it("parses a valid array of imported statements", () => {
    const parsed = parseQuestions([SAMPLE]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.correctAnswer).toBe(true);
  });

  it("rejects a statement with an empty explanation or missing answer", () => {
    expect(() => parseQuestions([{ ...SAMPLE, explanation: "" }])).toThrow();
    expect(() => parseQuestions([{ ...SAMPLE, statement: "" }])).toThrow();
    // correctAnswer must be a boolean
    expect(() => parseQuestions([{ ...SAMPLE, correctAnswer: "true" as unknown as boolean }])).toThrow();
  });

  it("inserts statements and round-trips the boolean answer", () => {
    insertQuestions(db, [SAMPLE], "2026-06-22T00:00:00Z");
    const q = pickNextForRotation(db, "MRI physics");
    expect(q?.statement).toBe(SAMPLE.statement);
    expect(q?.correctAnswer).toBe(true);
    expect(q?.usedAt).toBeNull();
  });

  it("picks never-used statements before used ones (LRU rotation)", () => {
    insertQuestions(db, [withStatement("first")], "2026-06-20T00:00:00Z");
    insertQuestions(db, [withStatement("second")], "2026-06-21T00:00:00Z");

    const a = pickNextForRotation(db, "MRI physics");
    expect(a?.statement).toBe("first");
    markUsed(db, [a!.id], "2026-06-22T00:00:00Z");

    const b = pickNextForRotation(db, "MRI physics");
    expect(b?.statement).toBe("second");
  });

  it("pickNextSet groups N statements from a single subtopic", () => {
    insertQuestions(
      db,
      [
        withStatement("mri-1", "MRI physics"),
        withStatement("mri-2", "MRI physics"),
        withStatement("mri-3", "MRI physics"),
        withStatement("ct-1", "CT physics"),
      ],
      "2026-06-20T00:00:00Z",
    );
    const set = pickNextSet(db, 5, "MRI physics");
    expect(set).toHaveLength(3);
    expect(set.every((q) => q.subtopic === "MRI physics")).toBe(true);
  });

  it("pickNextSet auto-selects a coherent subtopic when none is given", () => {
    insertQuestions(db, [withStatement("ct-1", "CT physics"), withStatement("ct-2", "CT physics")], "2026-06-20T00:00:00Z");
    insertQuestions(db, [withStatement("mri-1", "MRI physics")], "2026-06-21T00:00:00Z");
    const set = pickNextSet(db, 5);
    // CT statements are older (never-used, earlier created) so the CT subtopic leads
    expect(set.every((q) => q.subtopic === set[0]?.subtopic)).toBe(true);
    expect(set.length).toBeGreaterThan(0);
  });

  it("pickNextSet balances answers so a set is never all-TRUE or all-FALSE", () => {
    const inputs: ExamQuestionInput[] = [];
    for (let i = 0; i < 8; i++) inputs.push({ ...SAMPLE, statement: `false-${i}`, correctAnswer: false });
    for (let i = 0; i < 4; i++) inputs.push({ ...SAMPLE, statement: `true-${i}`, correctAnswer: true });
    insertQuestions(db, inputs, "2026-06-20T00:00:00Z");

    const set = pickNextSet(db, 5, "MRI physics");
    expect(set).toHaveLength(5);
    const trues = set.filter((q) => q.correctAnswer).length;
    expect(trues).toBeGreaterThan(0);
    expect(trues).toBeLessThan(5);
  });

  it("returns empty/undefined when no statement exists for a subtopic", () => {
    insertQuestions(db, [SAMPLE], "2026-06-22T00:00:00Z");
    expect(pickNextForRotation(db, "ultrasound")).toBeUndefined();
    expect(pickNextSet(db, 5, "ultrasound")).toEqual([]);
  });

  it("markUsedByStatements flags rows by statement text so used-state survives re-import (regenerated ids)", () => {
    // Simulate a CI re-import: fresh rows, fresh random ids, usedAt null.
    insertQuestions(
      db,
      [withStatement("first"), withStatement("second"), withStatement("third")],
      "2026-06-20T00:00:00Z",
    );

    const flagged = markUsedByStatements(db, ["first", "second"], "2026-06-22T00:00:00Z");
    expect(flagged).toBe(2);

    // The unused "third" now leads the rotation; the two flagged ones sort after it.
    const next = pickNextForRotation(db, "MRI physics");
    expect(next?.statement).toBe("third");
    expect(next?.usedAt).toBeNull();
  });

  it("markUsedByStatements is a no-op for an empty list", () => {
    insertQuestions(db, [withStatement("only")], "2026-06-20T00:00:00Z");
    expect(markUsedByStatements(db, [], "2026-06-22T00:00:00Z")).toBe(0);
    expect(pickNextForRotation(db, "MRI physics")?.usedAt).toBeNull();
  });
});

describe("balanceByAnswer", () => {
  const q = (id: string, correctAnswer: boolean): ExamQuestion =>
    ({ id, correctAnswer, statement: id, subtopic: "x", explanation: "", difficulty: null, source: null, usedAt: null, createdAt: "" }) as ExamQuestion;

  it("interleaves true/false starting with the lead class", () => {
    const pool = [q("f1", false), q("f2", false), q("t1", true), q("t2", true)];
    expect(balanceByAnswer(pool, 4, false).map((x) => x.id)).toEqual(["f1", "t1", "f2", "t2"]);
    expect(balanceByAnswer(pool, 4, true).map((x) => x.id)).toEqual(["t1", "f1", "t2", "f2"]);
  });

  it("falls back to the remaining class when one is exhausted (all-one-answer pools)", () => {
    const pool = [q("f1", false), q("f2", false), q("f3", false)];
    expect(balanceByAnswer(pool, 3, true).map((x) => x.id)).toEqual(["f1", "f2", "f3"]);
  });

  it("respects count and LRU order within each class", () => {
    const pool = [q("f1", false), q("t1", true), q("f2", false), q("t2", true), q("f3", false)];
    const out = balanceByAnswer(pool, 3, false);
    expect(out.map((x) => x.id)).toEqual(["f1", "t1", "f2"]);
  });
});
