import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeR2Host, r2ConfigFromEnv } from "../src/publishing/mediaHost";

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

async function main() {
  loadEnv();
  const cfg = r2ConfigFromEnv();
  if (!cfg) {
    console.error("R2 not configured (missing R2_* env vars)");
    process.exit(1);
  }
  console.log("R2 config:", { accountId: cfg.accountId, bucket: cfg.bucket, publicBaseUrl: cfg.publicBaseUrl });

  const bytes = new TextEncoder().encode(`r2-smoke ${process.env.R2_BUCKET} ok\n`);
  const host = makeR2Host(cfg, {
    fetchMedia: async () => ({ bytes, contentType: "text/plain", ext: ".txt" }),
    onFallback: (_u, err) => console.error("UPLOAD FAILED →", err instanceof Error ? err.message : err),
  });

  const result = await host.persist("https://example.com/smoke.txt");
  console.log("persist returned:", result);
  if (!result.startsWith(cfg.publicBaseUrl)) {
    console.error("FAIL: upload fell back to original URL (see error above)");
    process.exit(1);
  }
  console.log("OK: uploaded to R2. Verifying public fetch…");
  console.log("PUBLIC_URL=" + result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
