import { tickOnce } from "./jobs-tick";

/**
 * Always-on job-runner loop: drains due jobs (discovery, decode,
 * property-scrape, … per decode.config.yml's `jobs.schedules`) every
 * TICK_INTERVAL_MIN minutes (default 1), seeding any never-run schedules on
 * the first tick. Pair with cron + `npm run jobs:tick` for a stateless
 * alternative, or run this directly as an always-on watcher
 * (`npm run jobs:watch`).
 */
const minutes = Number(process.env.TICK_INTERVAL_MIN ?? 1);
const intervalMs = Math.max(1, minutes) * 60_000;

async function loop(): Promise<void> {
  try {
    const result = await tickOnce();
    if (result.claimed > 0) {
      console.log(
        `[scheduler] claimed ${result.claimed} · ok ${result.ok} · failed ${result.failed} · dead ${result.dead}`,
      );
    }
  } catch (err) {
    console.error("[scheduler] tick failed:", err instanceof Error ? err.message : err);
  }
}

console.log(`[scheduler] ticking every ${minutes} min — Ctrl+C to stop`);
void loop();
setInterval(() => void loop(), intervalMs);
