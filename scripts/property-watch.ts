import { runScrape } from "./scrape-property";

/**
 * Always-on daily property scrape: runs now, then every PROPERTY_INTERVAL_HOURS
 * (default 24). For a persistent machine; `npm run property:watch`. On a
 * box with cron, prefer a crontab line calling `npm run scrape:property`
 * (see scripts/README.md) so it survives reboots.
 */
const hours = Number(process.env.PROPERTY_INTERVAL_HOURS ?? 24);
const intervalMs = Math.max(1, hours) * 3_600_000;

async function tick(): Promise<void> {
  try {
    await runScrape();
  } catch (err) {
    console.error("[property-watch] failed:", err instanceof Error ? err.message : err);
  }
}

console.log(`[property-watch] scraping every ${hours}h — Ctrl+C to stop`);
void tick();
setInterval(() => void tick(), intervalMs);
