/**
 * Pipeline health check: verifies the external toolchain the content engine
 * depends on (ffmpeg/ffprobe for video re-editing, yt-dlp for clip ingest,
 * faster-whisper for caption timing) and that the OpenRouter key pool is
 * configured. Pass `--keys` to also ping each key against the configured model
 * (this spends a tiny number of tokens per key).
 *
 *   npm run doctor            # tools + key count, no network spend
 *   npm run doctor -- --keys  # also validate every OpenRouter key live
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { parseOpenRouterKeys } from "../src/lib/openRouterPool";

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

type Check = { name: string; ok: boolean; detail: string };

function checkBin(name: string, args: string[]): Check {
  const res = spawnSync(name, args, { encoding: "utf8" });
  if (res.error || res.status !== 0) {
    return { name, ok: false, detail: res.error?.message ?? `exit ${res.status}` };
  }
  const firstLine = (res.stdout || res.stderr).split("\n")[0]!.trim();
  return { name, ok: true, detail: firstLine };
}

function checkWhisper(): Check {
  const res = spawnSync(
    "python3",
    ["-c", "import faster_whisper, sys; sys.stdout.write(faster_whisper.__version__)"],
    { encoding: "utf8" },
  );
  if (res.error || res.status !== 0) {
    return { name: "faster-whisper", ok: false, detail: "python module not importable" };
  }
  return { name: "faster-whisper", ok: true, detail: `v${res.stdout.trim()}` };
}

async function pingKey(key: string, model: string, baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  loadEnv();
  const checks: Check[] = [
    checkBin("ffmpeg", ["-version"]),
    checkBin("ffprobe", ["-version"]),
    checkBin("yt-dlp", ["--version"]),
    checkWhisper(),
  ];

  const keys = parseOpenRouterKeys(process.env);
  const model = process.env.OPENROUTER_MODEL ?? "openrouter/owl-alpha";
  const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  checks.push({
    name: "OpenRouter keys",
    ok: keys.length > 0,
    detail: `${keys.length} key(s) in pool, model=${model}`,
  });

  if (process.argv.includes("--keys") && keys.length) {
    const results = await Promise.all(keys.map((k) => pingKey(k, model, baseUrl)));
    results.forEach((ok, i) => {
      checks.push({
        name: `  key #${i + 1}`,
        ok,
        detail: ok ? "resolves model ✓" : "rejected / model unavailable",
      });
    });
  }

  let allOk = true;
  for (const c of checks) {
    if (!c.ok) allOk = false;
    console.log(`${c.ok ? "✓" : "✗"} ${c.name.padEnd(18)} ${c.detail}`);
  }
  console.log(allOk ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
