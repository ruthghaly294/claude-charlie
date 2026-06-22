import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { createDb, getDb, type DB } from "../src/db/client";
import { loadConfig } from "../src/discovery/config";
import { runTrendImitation, type TrendStage } from "../src/publishing/runTrendImitation";
import { buildModeDeps } from "../src/publishing/trendModes";

/** Minimal .env loader so the CLI sees OPENROUTER/HIGGSFIELD/BUFFER keys. */
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
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

const STAGE_TITLE: Record<TrendStage, string> = {
  research: "1. RESEARCH — what's trending on this topic",
  exemplars: "2. RECIPES — why the top performers worked (imitate)",
  insight: "2b. INSIGHT — NotebookLM distilled research (outsourced)",
  music: "3. MUSIC — trending sounds → safe royalty-free match",
  brief: "4. BRIEF — our fresh take (innovate)",
  decision: "5. DECISION GATE — judge before we spend",
  cover: "6. COVER IMAGE — first frame",
  video: "7. VIDEO — vertical clip (+ audio)",
  virality: "8. VIRALITY GATE — will it perform?",
  publish: "9. PUBLISH — queue or draft",
};

/** Pretty-print one pipeline stage's data so you can watch it travel A→B. */
function printStage(stage: TrendStage, data: unknown): void {
  console.log("\n" + C.cyan("┌─ " + C.bold(STAGE_TITLE[stage])));
  const line = (s: string) => console.log(C.cyan("│  ") + s);

  if (stage === "research") {
    const picks = data as { title: string; source: string; score: number }[];
    if (picks.length === 0) line(C.dim("(no top picks)"));
    for (const p of picks.slice(0, 5)) line(`• [${p.source}] ${p.title} ${C.dim(`(score ${p.score})`)}`);
  } else if (stage === "exemplars") {
    const { items } = data as {
      items: { hookType: string; format: string; visualStyle: string; pacing: string; soundMood: string; cta: string }[];
    };
    for (const e of items) {
      line(`• hook=${C.yellow(e.hookType)} · format=${e.format} · sound=${e.soundMood}`);
      line(`  ${C.dim(`visual: ${e.visualStyle} | pacing: ${e.pacing} | cta: ${e.cta}`)}`);
    }
  } else if (stage === "insight") {
    const ins = data as {
      text: string;
      citations: string[];
      notebookId?: string;
      mode?: string;
      prompt?: string;
      addedSources?: string[];
    };
    line(C.dim(`mode=${ins.mode ?? "?"} · notebook=${ins.notebookId ?? "?"} · ${ins.text.length} chars · ${ins.citations.length} citations`));
    if (ins.addedSources?.length) line(C.dim(`sources pushed in: ${ins.addedSources.join(", ")}`));
    if (ins.prompt) {
      line(C.dim("── prompt sent to NotebookLM ──"));
      line(C.dim(ins.prompt.split("\n").join("\n│  ")));
    }
    line(C.dim("── insight returned ──"));
    line(ins.text.split("\n").join("\n│  "));
    if (ins.citations.length) line(C.dim(`citations: ${ins.citations.join(" | ")}`));
  } else if (stage === "music") {
    const tracks = data as { trend: { title: string; whereTrending: string; mood: string; energy: string }; safe: { embeddable: boolean; provider: string; searchQuery: string; trackUrl: string | null } }[];
    for (const t of tracks.slice(0, 8)) {
      const safe = t.safe.embeddable ? C.green(`✓ ${t.safe.trackUrl}`) : C.yellow(`search ${t.safe.provider}: "${t.safe.searchQuery}"`);
      line(`• ${t.trend.title} ${C.dim(`[${t.trend.whereTrending}, ${t.trend.mood}/${t.trend.energy}]`)}`);
      line(`  ${C.dim("safe →")} ${safe}`);
    }
  } else if (stage === "brief") {
    const { brief: b } = data as {
      brief: { hook: string; caption: string; hashtags: string[]; soundMood: string; shotList: { description: string; durationSec: number }[]; videoPrompt: string };
    };
    line(`hook: ${C.bold(b.hook)}`);
    b.shotList.forEach((s, i) => line(`  shot ${i + 1} (${s.durationSec}s): ${s.description}`));
    line(`caption: ${b.caption}`);
    line(`hashtags: ${b.hashtags.map((h) => "#" + h).join(" ")}`);
    line(`sound mood: ${b.soundMood}`);
    line(C.dim(`video prompt: ${b.videoPrompt}`));
  } else if (stage === "decision") {
    const d = data as { score: number; angle: string; rationale: string; threshold: number; cleared: boolean };
    line(`score: ${C.bold(String(d.score))}/100  threshold ${d.threshold}  →  ${d.cleared ? C.green("PROCEED") : C.yellow("SKIP (parked)")}`);
    line(`angle: ${d.angle}`);
    line(C.dim(d.rationale));
  } else if (stage === "cover") {
    line((data as { url: string }).url);
  } else if (stage === "video") {
    const v = data as { url: string; audioUsed: string | null };
    line(v.url);
    line(`audio: ${v.audioUsed ? C.green(v.audioUsed) : C.dim("none embedded (add platform sound in-app)")}`);
  } else if (stage === "virality") {
    const r = data as { score: number | null; reportUrl: string | null };
    line(`score: ${r.score ?? "n/a"}   ${r.reportUrl ? C.dim(r.reportUrl) : ""}`);
  } else if (stage === "publish") {
    const p = data as { status: string; bufferPostId: string | null; channelConfigured: boolean };
    line(`status: ${C.bold(p.status)}   buffer post: ${p.bufferPostId ?? C.dim(p.channelConfigured ? "—" : "(no channel configured)")}`);
  }
}

/**
 * Run the trend-imitation pipeline for a topic and print every stage A→B.
 *   --demo     instant canned sample (free, no network/keys)
 *   --dry-run  real trending research + deterministic recipes, stubbed video (free)
 *   (default)  full live run (uses Higgsfield credits; publishes if configured)
 */
export async function main(): Promise<void> {
  loadEnv();
  const args = process.argv.slice(2);
  const demo = args.includes("--demo");
  const dryRun = args.includes("--dry-run");
  const infographic = args.includes("--infographic");
  const mode = demo ? "demo" : dryRun ? "dry-run" : "live";
  const loaded = loadConfig();
  // --infographic forces the Nano Banana data-viz cover (same toggle the dashboard sends).
  const config = infographic
    ? { ...loaded, trendImitation: { ...loaded.trendImitation, assetStyle: "infographic" as const } }
    : loaded;

  const argTopics = args.filter((a) => !a.startsWith("-"));
  const topics = argTopics.length > 0 ? argTopics : config.trendImitation.topics;
  if (topics.length === 0) {
    console.log('[trend] pass a topic, e.g.  npm run trend -- --demo "AI coding tools"');
    return;
  }

  // Demo never touches the real DB; the others write where the app reads.
  const db: DB = demo ? createDb(":memory:") : getDb();

  for (const topic of topics) {
    console.log(C.bold(`\n══════ TREND-IMITATION PIPELINE · "${topic}" (${mode}) ══════`));
    const deps = buildModeDeps(mode, config, process.env, printStage, db);

    const r = await runTrendImitation(db, config, topic, deps);
    console.log(
      "\n" +
        C.green("✔ done") +
        ` · status=${r.status} · virality=${r.viralityScore ?? "n/a"} (passed=${r.passed}) · sounds catalogued=${r.soundsCatalogued}`,
    );
    console.log(`  video: ${r.videoUrl}`);
  }

  if (!demo) (db as DB).run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("trend failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
