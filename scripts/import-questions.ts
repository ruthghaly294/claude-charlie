import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../src/db/client";
import { parseQuestions, insertQuestions, type ExamQuestionInput } from "../src/publishing/examQuestions";
import {
  resolveSupabaseSource,
  fetchQuestionBankRows,
  mapQuestionBankRow,
} from "../src/publishing/supabaseQuestions";

/** Minimal .env loader (mirrors scripts/trend-imitation.ts) so DECODE_DB_PATH + SUPABASE_* are seen. */
function loadEnv(file = ".env.local"): void {
  const path = join(process.cwd(), file);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]!] !== undefined) continue;
    let v = m[2]!.trim();
    if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    process.env[m[1]!] = v;
  }
}

/**
 * Import human-verified FRCR questions into `exam_questions`.
 *
 *   npm run import-questions -- path/to/questions.json     # from a JSON file
 *   npm run import-questions -- --supabase                 # from the question_bank table
 *   npm run import-questions -- --supabase --inspect       # print columns + a sample, insert nothing
 *
 * Supabase mode needs SUPABASE_URL + SUPABASE_SERVICE_KEY (service_role bypasses RLS) in .env.local.
 */
async function fromFile(file: string): Promise<ExamQuestionInput[]> {
  const path = join(process.cwd(), file);
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  return parseQuestions(JSON.parse(readFileSync(path, "utf8")));
}

async function fromSupabase(inspect: boolean): Promise<ExamQuestionInput[]> {
  const source = resolveSupabaseSource(process.env);
  if (!source) {
    throw new Error(
      "Supabase mode needs SUPABASE_URL + SUPABASE_SERVICE_KEY (service_role, bypasses RLS) in .env.local",
    );
  }
  const rows = await fetchQuestionBankRows(source);
  if (rows.length === 0) {
    throw new Error(
      "question_bank returned 0 rows — the anon key is RLS-blocked; use the service_role key.",
    );
  }
  if (inspect) {
    console.log(`question_bank: ${rows.length} row(s). Columns of the first row:`);
    for (const [k, v] of Object.entries(rows[0]!)) {
      const preview = typeof v === "string" ? `"${v.slice(0, 60)}"` : JSON.stringify(v)?.slice(0, 80);
      console.log(`  • ${k} :: ${Array.isArray(v) ? "array" : typeof v} = ${preview}`);
    }
    return [];
  }
  const out: ExamQuestionInput[] = [];
  let failed = 0;
  for (const row of rows) {
    try {
      out.push(mapQuestionBankRow(row));
    } catch {
      failed += 1;
    }
  }
  if (failed) console.warn(`Skipped ${failed} row(s) that didn't match the verified-question shape.`);
  return out;
}

async function main(): Promise<void> {
  loadEnv();
  const args = process.argv.slice(2);
  const useSupabase = args.includes("--supabase");
  const inspect = args.includes("--inspect");
  const file = args.find((a) => !a.startsWith("-"));

  let questions: ExamQuestionInput[];
  try {
    questions = useSupabase ? await fromSupabase(inspect) : file ? await fromFile(file) : [];
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  if (useSupabase && inspect) return;
  if (questions.length === 0) {
    console.error("Nothing to import. Pass a JSON file path or --supabase.");
    process.exit(1);
  }

  const db = getDb();
  const n = insertQuestions(db, questions, new Date().toISOString());
  const bySubtopic = new Map<string, number>();
  for (const q of questions) bySubtopic.set(q.subtopic, (bySubtopic.get(q.subtopic) ?? 0) + 1);
  console.log(`Imported ${n} verified question(s):`);
  for (const [subtopic, count] of bySubtopic) console.log(`  • ${subtopic}: ${count}`);
}

void main();
