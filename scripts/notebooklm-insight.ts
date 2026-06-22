import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { getDb, type DB } from "../src/db/client";
import { loadConfig } from "../src/discovery/config";
import { runNotebookInsightJob, resolveNotebookLmSettings } from "../src/publishing/notebookInsight";
import { notebookLmConfigured } from "../src/research/notebookLm";

/** Minimal .env loader so the CLI sees NOTEBOOKLM_* / OPENROUTER keys. */
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
 * Standalone NotebookLM insight pass: query the configured notebook for each topic
 * and persist the insight into the `insights` table (flavor 1 — no discovery/render).
 *   npm run notebooklm -- "AI coding agents" "vertical video"
 * With no args, runs over trend_imitation.topics from decode.config.yml.
 */
async function main(): Promise<void> {
  loadEnv();
  const topics = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const config = loadConfig();
  const db: DB = getDb();

  const settings = resolveNotebookLmSettings(db, config);
  if (!settings.enabled) {
    console.log("[notebooklm] disabled — enable it in /settings/notebooklm or decode.config.yml.");
    return;
  }
  if (!notebookLmConfigured()) {
    console.log("[notebooklm] no cookies imported — paste a Cookie-Editor export in /settings/notebooklm first.");
    return;
  }
  if (!settings.notebookId) {
    console.log("[notebooklm] no notebook selected — set a notebook id in /settings/notebooklm.");
    return;
  }

  const produced = await runNotebookInsightJob(db, config, process.env, topics);
  console.log(
    produced.length
      ? `[notebooklm] insight written for: ${produced.join(", ")}`
      : "[notebooklm] no insights produced (check topics / notebook).",
  );

  db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("notebooklm failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
