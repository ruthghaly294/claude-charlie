import { getDb } from "@/db/client";
import { loadConfig } from "@/discovery/config";
import { buildRegistry } from "./registry";
import { tick } from "./runner";

/**
 * In-process worker for web-triggered trend-imitation runs. Started lazily from
 * the trend API route so the site can run the pipeline with no terminal and no
 * HTTP timeout. It drains ONLY `trend-imitation` jobs (never auto-fires
 * discovery/scrape), reusing the same atomic claim-and-run as `jobs:watch`.
 *
 * A `draining` guard keeps ticks sequential: overlapping interval fires are
 * skipped while a long render is in flight, so runs process one at a time.
 */
let started = false;
let draining = false;

const TICK_MS = 3_000;

async function drainOnce(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const db = getDb();
    const config = loadConfig();
    const registry = buildRegistry();
    await tick(db, registry, { kinds: ["trend-imitation"], ctx: { config, env: process.env } });
  } catch (err) {
    console.error("[trend-worker] tick failed:", err instanceof Error ? err.message : err);
  } finally {
    draining = false;
  }
}

/** Idempotent: starts the polling loop once per server process. */
export function ensureTrendWorker(): void {
  if (started) return;
  started = true;
  void drainOnce();
  const timer = setInterval(() => void drainOnce(), TICK_MS);
  // Don't keep the process alive solely for this timer.
  timer.unref?.();
}
