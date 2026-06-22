import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  resolveSupabaseSource,
  fetchQuestionBankRows,
  patchQuestionRow,
} from "../src/publishing/supabaseQuestions";
import { makeOpenRouterClient, hasOpenRouterKeys } from "../src/publishing/postGenerator";
import { detectWeakRows, proposeExplanation, type RegenProposal, type WeakRow } from "../src/publishing/regenerateExplanations";

/** Minimal .env loader (mirrors scripts/qotd.ts). */
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

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

/** Run `fn` over `items` with at most `n` in flight, preserving order. */
async function mapLimit<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
  return out;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

/**
 * Regenerate the question_bank's weak concise explanations (explanation1) by
 * condensing each row's verified long explanation. DRY-RUN by default — writes a
 * review file you inspect before committing. `--apply` backs up originals then
 * writes the regenerated explanations back to Supabase. Never touches the
 * statement or correct answer.
 *
 *   npm run regenerate-explanations                       # dry-run, all subtopics → review file
 *   npm run regenerate-explanations -- --limit 20         # cap how many to regenerate
 *   npm run regenerate-explanations -- --category mri_physics
 *   npm run regenerate-explanations -- --apply            # write back (after reviewing!)
 */
async function main(): Promise<void> {
  loadEnv();
  const apply = process.argv.includes("--apply");
  const limit = arg("limit") ? Number(arg("limit")) : undefined;
  const category = arg("category") ?? arg("subtopic");
  const model = arg("model") ?? process.env.OPENROUTER_MODEL ?? "anthropic/claude-3.7-sonnet";
  const concurrency = Number(arg("concurrency") ?? 4);

  const source = resolveSupabaseSource(process.env);
  if (!source) throw new Error("Supabase not configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY in .env.local)");
  if (!hasOpenRouterKeys(process.env)) throw new Error("OpenRouter not configured (set OPENROUTER_API_KEY in .env.local)");

  console.log(C.bold(`\nRegenerate weak question_bank explanations${apply ? C.red(" (APPLY — will write to Supabase)") : C.dim(" (dry-run)")}\n`));
  console.log(C.dim(`model: ${model}`));

  const allRows = await fetchQuestionBankRows(source, { limit: 5000 });
  const rows = category ? allRows.filter((r) => String(r.category ?? "").toLowerCase() === category.toLowerCase()) : allRows;
  const { regenerate, ungrounded } = detectWeakRows(rows);

  console.log(
    `Scanned ${C.bold(String(rows.length))} rows · ` +
      `${C.yellow(String(regenerate.length))} weak+groundable · ` +
      `${C.dim(String(ungrounded.length) + " weak but no usable long explanation (skipped, flag for human)")}`,
  );

  const todo: WeakRow[] = limit ? regenerate.slice(0, limit) : regenerate;
  if (todo.length === 0) {
    console.log(C.green("\nNothing to regenerate. ✓"));
    if (ungrounded.length) writeUngrounded(ungrounded);
    return;
  }

  const client = makeOpenRouterClient(process.env);
  console.log(C.cyan(`\nRegenerating ${todo.length} explanations…`));
  let done = 0;
  const proposals = await mapLimit(todo, concurrency, async (row) => {
    try {
      const p = await proposeExplanation(client, model, row);
      process.stdout.write(C.dim(`\r  ${++done}/${todo.length}`));
      return p;
    } catch (e) {
      process.stdout.write(C.red(`\r  ${++done}/${todo.length} (1 failed)`));
      return { id: row.id, statement: row.statement, correctAnswer: row.correctAnswer, before: row.current, after: "", error: String(e instanceof Error ? e.message : e) } as RegenProposal & { error: string };
    }
  });
  console.log();

  const ok = proposals.filter((p) => p.after && !("error" in p && p.error));
  const failed = proposals.filter((p) => !p.after || ("error" in p && (p as { error?: string }).error));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  const reviewPath = join(dir, `explanation-review-${stamp}.json`);
  writeFileSync(reviewPath, JSON.stringify({ model, total: proposals.length, ok: ok.length, failed: failed.length, ungrounded: ungrounded.length, proposals }, null, 2));
  console.log(C.green(`\nReview file: ${reviewPath}`));
  if (ungrounded.length) writeUngrounded(ungrounded);

  // Show a few before/after samples.
  console.log(C.bold("\nSample rewrites:"));
  for (const p of ok.slice(0, 3)) {
    console.log(C.dim(`\n• ${p.statement.slice(0, 80)} [${p.correctAnswer ? "TRUE" : "FALSE"}]`));
    console.log(C.red(`  before: ${p.before.slice(0, 110)}`));
    console.log(C.green(`  after : ${p.after.slice(0, 110)}`));
  }

  if (!apply) {
    console.log(C.yellow(`\nDry-run only. Review the file above, then re-run with ${C.bold("--apply")} to write ${ok.length} rows to Supabase.`));
    return;
  }

  // Apply: back up originals, then PATCH explanation1 only.
  const backupPath = join(dir, `explanation-backup-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(ok.map((p) => ({ id: p.id, explanation1: p.before })), null, 2));
  console.log(C.dim(`Backup of originals: ${backupPath}`));

  console.log(C.cyan(`\nWriting ${ok.length} rows to Supabase…`));
  let wrote = 0;
  let writeFailed = 0;
  await mapLimit(ok, concurrency, async (p) => {
    try {
      await patchQuestionRow(source, p.id, { explanation1: p.after });
      process.stdout.write(C.dim(`\r  ${++wrote + writeFailed}/${ok.length}`));
    } catch (e) {
      writeFailed++;
      console.error(C.red(`\n  PATCH failed for ${p.id}: ${e instanceof Error ? e.message : e}`));
    }
  });
  console.log(C.green(`\n\n✓ Updated ${wrote} explanations${writeFailed ? C.red(` (${writeFailed} failed)`) : ""}. Re-import to refresh the local DB: npm run import-questions -- --supabase`));
}

function writeUngrounded(ungrounded: WeakRow[]): void {
  const path = join(process.cwd(), "data", "explanation-ungrounded.json");
  writeFileSync(path, JSON.stringify(ungrounded.map((r) => ({ id: r.id, statement: r.statement, correctAnswer: r.correctAnswer, current: r.current })), null, 2));
  console.log(C.dim(`${ungrounded.length} weak rows lack a usable long explanation — listed for manual review: ${path}`));
}

main().catch((e) => {
  console.error(C.red(`\n${e instanceof Error ? e.message : String(e)}`));
  process.exit(1);
});
