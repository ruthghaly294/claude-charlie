import { z } from "zod";
import type { PostGenClient } from "./postGenerator";
import { extractJson } from "@/lib/extractJson";
import { isWeakExplanation } from "./supabaseQuestions";

/**
 * Root-fix for the FRCR question_bank's weak concise explanations (`explanation1`).
 * Many were auto-generated and are contradictory or filler (see [[isWeakExplanation]]).
 * We regenerate them by CONDENSING the row's verified long `explanation` — grounded
 * in existing verified content, never invented from the model's own knowledge — into
 * one clean sentence consistent with the statement + correct answer. The statement
 * and correct_answer are NEVER touched.
 */
export type QuestionRow = Record<string, unknown>;

export type WeakRow = {
  id: string;
  statement: string;
  correctAnswer: boolean;
  /** The verified long-form explanation we condense from (the grounding source). */
  longExplanation: string;
  /** The current weak explanation1 (for the review diff). */
  current: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function coerceBool(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw === 1;
  if (typeof raw === "string") return /^(true|t|1|yes)$/i.test(raw.trim());
  return false;
}

/**
 * Select the rows worth regenerating: a weak `explanation1` AND a substantive long
 * `explanation` to ground the rewrite. Rows with a weak concise explanation but no
 * usable long explanation are returned separately as `ungrounded` (flag for a human,
 * never machine-invented).
 */
export function detectWeakRows(rows: QuestionRow[]): { regenerate: WeakRow[]; ungrounded: WeakRow[] } {
  const regenerate: WeakRow[] = [];
  const ungrounded: WeakRow[] = [];
  for (const row of rows) {
    const id = str(row.id ?? row.uuid);
    const statement = str(row.question_text ?? row.statement ?? row.question ?? row.stem);
    if (!id || !statement) continue;
    const current = str(row.explanation1);
    if (!isWeakExplanation(current)) continue;
    const longExplanation = str(row.explanation);
    const entry: WeakRow = { id, statement, correctAnswer: coerceBool(row.correct_answer ?? row.answer), longExplanation, current };
    // The long explanation must itself be substantive (not also boilerplate) to ground a rewrite.
    if (longExplanation.replace(/\s+/g, " ").trim().length >= 60 && !isWeakExplanation(longExplanation)) {
      regenerate.push(entry);
    } else {
      ungrounded.push(entry);
    }
  }
  return { regenerate, ungrounded };
}

export const REGEN_SYSTEM = `You are a consultant radiologist physicist writing the single-sentence teaching takeaway shown beneath an FRCR Part 1 Physics true/false answer.

You are given a STATEMENT, its correct ANSWER (TRUE or FALSE), and a VERIFIED detailed explanation. Write a concise replacement explanation.

Hard rules:
- Ground every claim ONLY in the VERIFIED detailed explanation and the statement. Never introduce facts they do not support.
- Be consistent with the ANSWER: if FALSE, state the correct version / why the statement is wrong; if TRUE, state why it holds.
- 1 sentence (2 only if essential), maximum ~40 words. Plain prose a trainee can read at a glance.
- Do NOT start with "This statement is correct/incorrect" or any verdict — the badge already shows TRUE/FALSE.
- No filler ("as a consequence of the underlying physics", "conforming to fundamental principles"), no markdown, no headings, no "Explanation:" label.
Return strict JSON: {"explanation": "..."}.`;

export function buildRegenUser(row: WeakRow): string {
  return [
    `STATEMENT: ${row.statement.trim()}`,
    `ANSWER: ${row.correctAnswer ? "TRUE" : "FALSE"}`,
    `VERIFIED detailed explanation:\n${row.longExplanation.trim()}`,
  ].join("\n\n");
}

const responseSchema = z.object({ explanation: z.string().min(1) });

export type RegenProposal = { id: string; statement: string; correctAnswer: boolean; before: string; after: string };

/** Ask the model for one condensed explanation, grounded in the verified long form. */
export async function proposeExplanation(
  client: PostGenClient,
  model: string,
  row: WeakRow,
): Promise<RegenProposal> {
  const res = await client.complete({
    model,
    response_format: {
      type: "json_schema",
      json_schema: { name: "explanation", strict: true, schema: z.toJSONSchema(responseSchema) },
    },
    messages: [
      { role: "system", content: REGEN_SYSTEM },
      { role: "user", content: buildRegenUser(row) },
    ],
  });
  const parsed = responseSchema.parse(extractJson(res.content));
  return {
    id: row.id,
    statement: row.statement,
    correctAnswer: row.correctAnswer,
    before: row.current,
    after: parsed.explanation.replace(/\s+/g, " ").trim(),
  };
}
