import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCritic } from "../src/discovery/critic";

/** Minimal .env loader (mirrors scripts/decode.ts). */
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

const FIXTURES = [
  {
    title: "Smart-Money Tracker: this week's congressional buys",
    lane: "content",
    body: "## What changed\nThree senators disclosed concentrated semiconductor buys...\n## Why it matters\n...\n## Trade ideas\n1. ...",
  },
  {
    title: "Generic thoughts on the market",
    lane: "content",
    body: "Markets went up and down. Stocks are interesting. Consider investing carefully.",
  },
];

async function main(): Promise<void> {
  loadEnv();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("Set ANTHROPIC_API_KEY in .env.local to run the live critic eval.");
    return;
  }
  const critic = getCritic(process.env);
  for (const f of FIXTURES) {
    const r = await critic.scoreDraft(f);
    console.log(`\n${f.title}\n  score: ${r.score}/5\n  notes: ${r.notes}`);
  }
}

main().catch((err) => {
  console.error("eval failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
