import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { loadConfig } from "../src/discovery/config";
import { buildRegistry } from "../src/jobs/registry";
import { tick, seedSchedules } from "../src/jobs/runner";

/** Minimal .env loader so the CLI sees DECODE_CONFIG / ANTHROPIC_API_KEY. */
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
 * Drain every due job once, then exit. What GitHub Actions / cron calls
 * (`npm run jobs:tick`); the always-on equivalent is `npm run jobs:watch`
 * (scripts/scheduler.ts), a thin loop around the same `tick()`.
 */
export async function tickOnce(): Promise<ReturnType<typeof tick>> {
  loadEnv();
  const db = getDb();
  const config = loadConfig();
  const registry = buildRegistry();
  seedSchedules(db, registry, config.jobs.schedules);
  const result = await tick(db, registry, {
    schedules: config.jobs.schedules,
    ctx: { config, env: process.env },
  });
  // fold the WAL into the .db file so it's complete on its own (CI commits it)
  db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
  return result;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  tickOnce()
    .then((result) => {
      console.log(
        `[jobs:tick] claimed ${result.claimed} · ok ${result.ok} · failed ${result.failed} · dead ${result.dead}`,
      );
    })
    .catch((err) => {
      console.error("jobs:tick failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
