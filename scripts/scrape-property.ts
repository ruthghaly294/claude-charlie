import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../src/db/client";
import { loadConfig } from "../src/discovery/config";
import { ingestReference } from "../src/property/referenceIngest";
import { scrapeAllAgents } from "../src/property/agentScrape";
import { enrichAllListings } from "../src/property/listings";
import { loadSources } from "../src/property/sources";
import { getExtractClient } from "../src/property/llmExtract";
import { postcodeValues } from "../src/db/schema";
import { count, sql } from "drizzle-orm";

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
 * Hands-off property update: ensure the LPS reference data exists, then scrape
 * every registered estate agent for East/South Belfast listings, valuing and
 * de-duplicating them. Point cron at `npm run scrape:property`.
 */
export async function runScrape(): Promise<void> {
  loadEnv();
  const db = getDb();
  const haveRef = (db.select({ n: count() }).from(postcodeValues).get()?.n ?? 0) > 0;
  if (!haveRef || process.env.REFRESH_REFERENCE) {
    console.log("Loading LPS reference data…");
    const r = await ingestReference(db);
    console.log(`  ${r.postcodes} postcodes, ${r.coefs} coefficients (${r.quarter})`);
  }
  const config = loadConfig();
  const { extraction, geocode } = config.property;
  const max = Number(process.env.PROPERTY_MAX ?? 25);
  console.log(`[${new Date().toISOString()}] Scraping agents (max ${max}/agent)…`);
  for (const s of await scrapeAllAgents(db, {
    max,
    agents: loadSources(config.property.sources),
    extractClient: extraction.llmRepair ? getExtractClient() : null,
    llmRepair: extraction.llmRepair,
    llmMaxPagesPerRun: extraction.llmMaxPagesPerRun,
    geocodeProviders: geocode.providers,
  })) {
    console.log(`  ${s.agent}: ${s.imported} listings (${s.geocoded} geocoded)`);
  }
  console.log("Backfilling LPS facts (real floor areas) + revaluing…");
  const e = await enrichAllListings(db);
  console.log(
    `  ${e.withLpsSize} of ${e.scanned} listings on real LPS size (${e.revalued} revalued)`,
  );
  // fold the WAL into the .db file so it's complete on its own (CI commits it)
  db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runScrape().catch((err) => {
    console.error("scrape failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
