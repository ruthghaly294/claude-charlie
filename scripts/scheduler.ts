import { runOnce } from "./decode";

/**
 * Dependency-free scheduler: run the DECODE loop now, then every
 * DECODE_INTERVAL_MIN minutes (default 30). Pair with cron for a hands-off
 * setup, or run this directly as an always-on watcher (`npm run decode:watch`).
 */
const minutes = Number(process.env.DECODE_INTERVAL_MIN ?? 30);
const intervalMs = Math.max(1, minutes) * 60_000;

async function tick(): Promise<void> {
  try {
    await runOnce();
  } catch (err) {
    console.error("[scheduler] run failed:", err instanceof Error ? err.message : err);
  }
}

console.log(`[scheduler] running DECODE every ${minutes} min — Ctrl+C to stop`);
void tick();
setInterval(() => void tick(), intervalMs);
