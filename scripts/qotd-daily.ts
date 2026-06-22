import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { getDb } from "../src/db/client";
import { loadConfig } from "../src/discovery/config";
import { runQotdCarousel } from "../src/publishing/runQotd";
import { markUsedByStatements } from "../src/publishing/examQuestions";
import {
  decideRun,
  recordRun,
  emptyScheduleState,
  type QotdScheduleState,
} from "../src/publishing/qotdSchedule";

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

// State persists ACROSS runs and must survive a fresh checkout, so in CI it points
// at a committed path (set QOTD_STATE_PATH=.github/qotd-state.json in the workflow);
// locally it defaults under data/ (gitignored — fine for a single machine).
const STATE_PATH = process.env.QOTD_STATE_PATH
  ? join(process.cwd(), process.env.QOTD_STATE_PATH)
  : join(process.cwd(), "data", "qotd-schedule.json");
const TOTAL_RUNS = Number(process.env.QOTD_SCHEDULE_DAYS ?? 30);

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function loadState(today: string): QotdScheduleState {
  if (!existsSync(STATE_PATH)) return emptyScheduleState(today);
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8")) as Partial<QotdScheduleState>;
    // Back-compat: older state files predate usedStatements.
    return { ...emptyScheduleState(today), ...parsed, usedStatements: parsed.usedStatements ?? [] };
  } catch {
    return emptyScheduleState(today);
  }
}

function saveState(state: QotdScheduleState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Hands-off daily Question-of-the-Day draft. Triggered once a day (cron or manual),
 * it picks the next subtopic in the fixed rotation (X-ray → … → Radiation safety,
 * cycling), creates a Buffer DRAFT for /review, and advances the schedule. Idempotent
 * per day; stops after QOTD_SCHEDULE_DAYS (default 30) successful drafts. Nothing
 * auto-publishes — you approve each draft on the /review dashboard.
 *
 *   npm run qotd:daily            # run today's draft (no-op if already run today / schedule done)
 *   QOTD_SCHEDULE_DAYS=60 ...     # change the run cap
 */
async function main(): Promise<void> {
  loadEnv();
  const today = todayUtc();
  const state = loadState(today);
  const decision = decideRun(state, today, TOTAL_RUNS);

  if (!decision.run) {
    const msg =
      decision.reason === "already-ran-today"
        ? `Already generated today's draft (${state.runsCompleted}/${TOTAL_RUNS}). Nothing to do.`
        : `Schedule complete — ${state.runsCompleted} drafts generated. Remove the cron entry when ready.`;
    console.log(msg);
    return;
  }

  console.log(`QOTD daily ${decision.runIndex + 1}/${TOTAL_RUNS} — subtopic: ${decision.subtopic}`);
  const db = getDb();

  // Replay previously-used statements onto this (possibly freshly re-imported) DB so
  // the LRU rotation skips anything already drafted — ids are regenerated per import,
  // so statement text is the only durable key.
  const replayed = markUsedByStatements(db, state.usedStatements, new Date().toISOString());
  if (state.usedStatements.length) {
    console.log(`Skipping ${replayed}/${state.usedStatements.length} already-used statement(s).`);
  }

  const res = await runQotdCarousel(db, loadConfig(), process.env, {
    subtopic: decision.subtopic,
    count: 5,
    publish: true, // creates a Buffer DRAFT (saveToDraft forced); never auto-publishes
  });

  if (res.status !== "draft" && !res.bufferPostId) {
    // Buffer wasn't configured / no channel — the carousel rendered but no draft was created.
    throw new Error(
      `Carousel generated but no Buffer draft was created (status=${res.status}). ` +
        `Check BUFFER_ACCESS_TOKEN and the Instagram channel; schedule NOT advanced so it retries.`,
    );
  }

  saveState(recordRun(state, today, res.statements));
  console.log(
    `✓ Draft created on /review — ${res.subtopic}, ${res.slideCount} slides, Buffer ${res.bufferPostId}. ` +
      `(${state.runsCompleted + 1}/${TOTAL_RUNS})`,
  );
}

main().catch((e) => {
  console.error(`qotd:daily failed — ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
