import { randomUUID } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { examQuestions, type ExamQuestion, type NewExamQuestion } from "@/db/schema";

/**
 * Validation for an operator-imported, human-verified FRCR statement. The pipeline
 * renders these verbatim — it never authors the medical content — so the import is
 * the accuracy gate. One row = one true/false statement (the FRCR format); the
 * Question-of-the-Day carousel groups several from a subtopic into a 5-part question.
 */
export const examQuestionInputSchema = z.object({
  subtopic: z.string().min(1),
  statement: z.string().min(1),
  correctAnswer: z.boolean(),
  explanation: z.string().min(1),
  difficulty: z.string().optional(),
  source: z.string().optional(),
});
export type ExamQuestionInput = z.infer<typeof examQuestionInputSchema>;

/** Parse + validate a raw import payload (array of statements). Throws on bad input. */
export function parseQuestions(raw: unknown): ExamQuestionInput[] {
  return z.array(examQuestionInputSchema).min(1).parse(raw);
}

/** Insert verified statements. Returns the number inserted. */
export function insertQuestions(db: DB, inputs: ExamQuestionInput[], now: string): number {
  if (inputs.length === 0) return 0;
  const rows: NewExamQuestion[] = inputs.map((q) => ({
    id: randomUUID(),
    subtopic: q.subtopic,
    statement: q.statement,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    difficulty: q.difficulty ?? null,
    source: q.source ?? null,
    usedAt: null,
    createdAt: now,
  }));
  db.insert(examQuestions).values(rows).run();
  return rows.length;
}

/** least-recently-used ordering: never-used first, then oldest usedAt, then oldest created. */
const LRU_ORDER = [
  sql`${examQuestions.usedAt} is not null`,
  asc(examQuestions.usedAt),
  asc(examQuestions.createdAt),
] as const;

/**
 * Pick the next single statement: never-used first, then least-recently-used.
 * Optionally constrained to one subtopic (content pillar).
 */
export function pickNextForRotation(db: DB, subtopic?: string): ExamQuestion | undefined {
  const base = db.select().from(examQuestions).$dynamic();
  const scoped = subtopic ? base.where(eq(examQuestions.subtopic, subtopic)) : base;
  return scoped.orderBy(...LRU_ORDER).limit(1).get();
}

/**
 * Interleave true- and false-answer statements (each list already in LRU order)
 * so a set is never all-TRUE or all-FALSE — otherwise the "true or false?" game
 * is trivial and the carousel looks broken. Draws round-robin, least-recently-used
 * first within each class, starting with `startWithTrue` so the lead class tracks
 * rotation. Falls back to the other class once one is exhausted.
 */
export function balanceByAnswer(pool: ExamQuestion[], count: number, startWithTrue: boolean): ExamQuestion[] {
  const trues = pool.filter((q) => q.correctAnswer);
  const falses = pool.filter((q) => !q.correctAnswer);
  const out: ExamQuestion[] = [];
  let takeTrue = startWithTrue;
  let ti = 0;
  let fi = 0;
  while (out.length < count && (ti < trues.length || fi < falses.length)) {
    if (takeTrue && ti < trues.length) out.push(trues[ti++]!);
    else if (!takeTrue && fi < falses.length) out.push(falses[fi++]!);
    else if (ti < trues.length) out.push(trues[ti++]!);
    else out.push(falses[fi++]!);
    takeTrue = !takeTrue;
  }
  return out;
}

/**
 * Pick a coherent set of `count` statements from ONE subtopic for a 5-part carousel.
 * The subtopic is chosen by rotation (the least-recently-used statement leads), then
 * the set is drawn LRU-first but BALANCED across true/false answers (see
 * `balanceByAnswer`) so it's never all-one-answer.
 */
export function pickNextSet(db: DB, count: number, subtopic?: string): ExamQuestion[] {
  const lead = pickNextForRotation(db, subtopic);
  if (!lead) return [];
  const pool = db
    .select()
    .from(examQuestions)
    .where(eq(examQuestions.subtopic, lead.subtopic))
    .orderBy(...LRU_ORDER)
    .all();
  return balanceByAnswer(pool, count, lead.correctAnswer);
}

/** Mark statements as just posted, so rotation moves on. */
export function markUsed(db: DB, ids: string[], now: string): void {
  for (const id of ids) {
    db.update(examQuestions).set({ usedAt: now }).where(eq(examQuestions.id, id)).run();
  }
}

/**
 * Mark statements as used by their TEXT rather than id. Row ids are regenerated on
 * every import (randomUUID), so a scheduler that re-imports from Supabase each run
 * (e.g. GitHub Actions) can't persist used-state by id. The statement text is the
 * stable key, so the daily runner records used statements and replays them here
 * after each re-import to keep the LRU rotation from repeating questions.
 * Returns the number of rows flagged.
 */
export function markUsedByStatements(db: DB, statements: string[], now: string): number {
  if (statements.length === 0) return 0;
  const res = db
    .update(examQuestions)
    .set({ usedAt: now })
    .where(inArray(examQuestions.statement, statements))
    .run();
  return res.changes;
}
