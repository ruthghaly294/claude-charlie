import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { loadConfig } from "../src/discovery/config";
import { buildNotifiers } from "../src/notify/build";
import { UsageMeter } from "../src/discovery/usage";
import { runSeoAudit } from "../src/seo/audit";
import { getReasonerClient } from "../src/seo/reasoner";
import { upsertSite, type SiteInput } from "../src/seo/store";

/** Minimal .env loader so the CLI sees DECODE_CONFIG / ANTHROPIC_API_KEY / SEO_SERP_URL. */
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
 * Run an SEO/GEO audit for every site in config (or a single --domain passed on
 * the CLI). Persists results to the same DB the dashboard reads, so a manual run
 * and the weekly job are interchangeable.
 */
export async function auditAll(): Promise<void> {
  loadEnv();
  const db = getDb();
  const config = loadConfig();
  const meter = new UsageMeter();
  const reasonerClient = getReasonerClient(process.env);
  const notifiers = buildNotifiers(config.notify, process.env);

  const domainArg = process.argv.find((a) => a.startsWith("--domain="))?.split("=")[1];
  const sites: SiteInput[] = domainArg
    ? [{ domain: domainArg, competitors: [], keywords: [] }]
    : config.seo.sites;

  if (sites.length === 0) {
    console.log("[seo:audit] no sites configured — add seo.sites to your config or pass --domain=");
    return;
  }

  for (const input of sites) {
    const site = upsertSite(db, input);
    const summary = await runSeoAudit(db, site, {
      reasonerClient,
      meter,
      notifiers,
      env: process.env,
      autoResolveAfterRuns: config.seo.autoResolveAfterRuns,
    });
    console.log(
      `[seo:audit] ${site.domain} · ${summary.status} · ${summary.pagesCrawled} pages · ` +
        `${summary.recommendationsNew} new / ${summary.recommendationsTotal} total · ` +
        `SEO ${summary.scores.seo} GEO ${summary.scores.geo} overall ${summary.scores.overall}`,
    );
  }
  console.log(`[seo:audit] llm cost $${meter.totals.costUsd}`);
  db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  auditAll().catch((err) => {
    console.error("seo:audit failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
