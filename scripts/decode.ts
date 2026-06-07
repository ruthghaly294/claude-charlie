import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../src/db/client";
import { loadConfig } from "../src/discovery/config";
import { runDecode } from "../src/discovery/runDecode";
import { getReasoner } from "../src/discovery/claudeReasoner";
import { getCritic } from "../src/discovery/critic";
import { UsageMeter } from "../src/discovery/usage";

/** Minimal .env loader so the CLI sees DECODE_CONFIG / ANTHROPIC_API_KEY. */
function loadEnv(file = ".env.local"): void {
  const path = join(process.cwd(), file);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1]!;
    if (process.env[key] !== undefined) continue;
    let val = m[2]!.trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

/** Run the full DECODE loop once and print the digest + cost. Returns exit-ish. */
export async function runOnce(): Promise<void> {
  loadEnv();
  const db = getDb();
  const config = loadConfig();
  const meter = new UsageMeter();
  const reasoner = getReasoner(
    {
      businessName: config.businessName,
      businessDescription: config.businessDescription,
      profile: config.profile,
    },
    process.env,
    meter,
  );
  const critic = getCritic(process.env, meter);

  const usingLlm =
    !!process.env.ANTHROPIC_API_KEY &&
    process.env.DECODE_REASONER !== "deterministic";
  console.log(
    `DECODE · ${config.businessName} · reasoner=${usingLlm ? "claude" : "deterministic"}`,
  );

  const d = await runDecode(db, config, { reasoner, critic, meter });
  const t = meter.totals;

  console.log(
    [
      "",
      `  Signals     kept ${d.signals.kept} · archived ${d.signals.archived}`,
      `  Insights    ${d.insights.count}${d.insights.top[0] ? `  — ${d.insights.top[0].trend}` : ""}`,
      `  Decisions   ${d.decisions.count}${d.decisions.top[0] ? `  — ${d.decisions.top[0].title} (P${d.decisions.top[0].priority})` : ""}`,
      `  Execution   ${d.executions.count}${d.executions.top[0] ? `  — ${d.executions.top[0].title}` : ""}`,
      "",
      `  Tokens      ${t.tokensIn} in · ${t.tokensOut} out · $${t.costUsd}`,
      "",
    ].join("\n"),
  );
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runOnce().catch((err) => {
    console.error("decode failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
