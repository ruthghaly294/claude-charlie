import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../src/db/client";
import { loadConfig } from "../src/discovery/config";
import { runQotdCarousel, type QotdStage } from "../src/publishing/runQotd";

/** Minimal .env loader (mirrors scripts/trend-imitation.ts). */
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

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
};

const STAGE_TITLE: Record<QotdStage, string> = {
  questions: "1. ROTATION — verified statements picked",
  carousel: "2. CAROUSEL — slide plan + caption",
  background: "3. BACKGROUND — on-brand watercolor canvas (Nano Banana Pro)",
  render: "4. RENDER — branded slide PNGs",
  host: "5. HOST — durable slide URLs",
  publish: "6. PUBLISH — Buffer draft for review",
};

/**
 * Run the Question-of-the-Day carousel.
 *   npm run qotd -- --dry-run                 # render previews into data/qotd-preview, no publish
 *   npm run qotd -- "MRI physics"             # specific subtopic
 *   npm run qotd -- --count 5                 # statements per carousel (default 5)
 */
async function main(): Promise<void> {
  loadEnv();
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const countArg = args[args.indexOf("--count") + 1];
  const count = args.includes("--count") && countArg ? Number(countArg) : undefined;
  const subtopic = args.find((a) => !a.startsWith("-") && a !== countArg);

  const config = loadConfig();
  const db = getDb();

  console.log(C.bold(`\nQuestion-of-the-Day carousel${dryRun ? C.dim(" (dry-run)") : ""}\n`));

  const res = await runQotdCarousel(db, config, process.env, {
    subtopic,
    count,
    dryRun,
    deps: {
      onStage: (stage, data) => {
        console.log(C.cyan(`┌─ ${C.bold(STAGE_TITLE[stage])}`));
        console.log(C.cyan("│  ") + C.dim(JSON.stringify(data)));
      },
    },
  });

  console.log("\n" + C.bold("Caption:"));
  console.log(res.caption);
  console.log("\n" + C.bold(`Slides (${res.slideCount}):`));
  for (const u of res.slideUrls) console.log("  • " + u);
  if (dryRun) {
    console.log(C.green(`\n✓ Dry-run complete — preview the PNGs in data/qotd-preview/. Nothing published.`));
  } else {
    console.log(
      C.green(
        `\n✓ ${res.status === "draft" ? "Draft created on Buffer" : "Generated"} (${res.subtopic}) — review it on /review before publishing.`,
      ),
    );
  }
}

void main();
