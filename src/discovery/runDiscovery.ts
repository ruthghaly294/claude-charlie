import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  signals,
  discoveryRuns,
  type SourceRunResult,
  type NewSignal,
} from "@/db/schema";
import type { Connector, ConnectorContext, RawSignal } from "./types";
import { parseRawSignals } from "./types";
import { CONNECTORS } from "./connectors";
import { hashKey, scoreSignal, slugify } from "./scoring";
import type { DecodeConfig } from "./config";

export type RunOptions = {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  /** override the connector set (tests inject fakes) */
  connectors?: Connector[];
  /** also write each new signal as a markdown note into the vault */
  writeVault?: boolean;
  /** feedback multipliers keyword→factor; if omitted, read from the vault */
  multipliers?: Record<string, number>;
};

export type DiscoverySummary = {
  runId: string;
  status: "ok" | "partial" | "error";
  totalFound: number;
  totalNew: number;
  perSource: SourceRunResult[];
};

/** Read 70-Feedback/ranking.tsv (keyword<TAB>multiplier) if present. */
export function loadMultipliers(vault: string): Record<string, number> {
  const path = join(vault, "70-Feedback", "ranking.tsv");
  if (!existsSync(path)) return {};
  const out: Record<string, number> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [k, m] = line.split("\t");
    if (k && m && Number.isFinite(Number(m))) out[k.toLowerCase()] = Number(m);
  }
  return out;
}

function writeVaultNote(vault: string, s: NewSignal): void {
  const dir = join(vault, "01-Signals");
  if (!existsSync(dir)) return;
  const slug = slugify(s.title) || "signal";
  const date = new Date().toISOString().slice(0, 10);
  let target = join(dir, `${date}-${slug}.md`);
  let i = 1;
  while (existsSync(target)) target = join(dir, `${date}-${slug}-${i++}.md`);
  const dq = (v: string) =>
    `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const body = [
    "---",
    `source: ${s.source}`,
    `title: ${dq(s.title)}`,
    `url: ${s.url ?? ""}`,
    `captured_at: ${s.capturedAt}`,
    `tags: [signal, ${s.source}]`,
    `score: ${s.score ?? "null"}`,
    `cluster: ${s.cluster ?? "null"}`,
    "---",
    "",
    `# ${s.title}`,
    "",
    s.url ? `<${s.url}>\n` : "",
    s.raw ?? "",
    "",
  ].join("\n");
  writeFileSync(target, body);
}

/**
 * Run every configured connector, dedup + score the results, persist new signals
 * to the DB (and optionally the vault), and record a discovery_runs row.
 * Connector failures are isolated: one bad source never aborts the run.
 */
export async function runDiscovery(
  db: DB,
  config: DecodeConfig,
  opts: RunOptions = {},
): Promise<DiscoverySummary> {
  const {
    fetchImpl = fetch,
    env = process.env,
    signal,
    connectors = CONNECTORS,
    writeVault = false,
    multipliers = loadMultipliers(config.vault),
  } = opts;

  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  db.insert(discoveryRuns)
    .values({ id: runId, startedAt, status: "running" })
    .run();

  const perSource: SourceRunResult[] = [];
  const collected: RawSignal[] = [];

  for (const connector of connectors) {
    const ctx: ConnectorContext = {
      keywords: config.keywords,
      businessName: config.businessName,
      config: config.sources[connector.key],
      env,
      fetchImpl,
      signal,
    };
    const started = Date.now();
    const st = connector.state(ctx);
    if (!st.configured) {
      perSource.push({
        source: connector.key,
        status: "skipped",
        found: 0,
        added: 0,
        durationMs: 0,
        error: st.reason,
      });
      continue;
    }
    try {
      const raw = await connector.fetch(ctx);
      const valid = parseRawSignals(connector.key, raw as unknown[]);
      collected.push(...valid);
      perSource.push({
        source: connector.key,
        status: "ok",
        found: valid.length,
        added: 0,
        durationMs: Date.now() - started,
      });
    } catch (err) {
      perSource.push({
        source: connector.key,
        status: "error",
        found: 0,
        added: 0,
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // dedup within this batch by hash key
  const byHash = new Map<string, RawSignal>();
  for (const s of collected) {
    const h = hashKey(s.url, s.title);
    if (!byHash.has(h)) byHash.set(h, s);
  }

  // drop anything already in the DB
  const hashes = [...byHash.keys()];
  const existing = new Set<string>();
  for (let i = 0; i < hashes.length; i += 400) {
    const chunk = hashes.slice(i, i + 400);
    if (chunk.length === 0) continue;
    const rows = db
      .select({ h: signals.urlHash })
      .from(signals)
      .where(inArray(signals.urlHash, chunk))
      .all();
    for (const r of rows) existing.add(r.h);
  }

  const capturedAt = new Date().toISOString();
  const addedBySource = new Map<string, number>();
  const rows: NewSignal[] = [];

  for (const [h, s] of byHash) {
    if (existing.has(h)) continue;
    const { score, cluster } = scoreSignal(
      `${s.title} ${s.raw}`,
      config.keywords,
      multipliers,
      s.source,
    );
    const row: NewSignal = {
      id: randomUUID(),
      source: s.source,
      title: s.title,
      url: s.url,
      urlHash: h,
      author: s.author,
      publishedAt: s.publishedAt,
      raw: s.raw,
      tags: s.tags,
      score,
      cluster,
      status: score >= config.keepThreshold ? "new" : "archived",
      capturedAt,
      runId,
    };
    rows.push(row);
    addedBySource.set(s.source, (addedBySource.get(s.source) ?? 0) + 1);
  }

  if (rows.length > 0) {
    db.insert(signals).values(rows).onConflictDoNothing().run();
    if (writeVault && existsSync(config.vault)) {
      mkdirSync(join(config.vault, "01-Signals"), { recursive: true });
      for (const r of rows) writeVaultNote(config.vault, r);
    }
  }

  // attribute 'added' back to the per-source rows (source === connector key)
  for (const ps of perSource) {
    ps.added = addedBySource.get(ps.source) ?? 0;
  }

  const hadError = perSource.some((p) => p.status === "error");
  const hadOk = perSource.some((p) => p.status === "ok");
  const status: DiscoverySummary["status"] = hadError
    ? hadOk
      ? "partial"
      : "error"
    : "ok";

  db.update(discoveryRuns)
    .set({
      finishedAt: new Date().toISOString(),
      status,
      totalFound: collected.length,
      totalNew: rows.length,
      perSource,
    })
    .where(inArray(discoveryRuns.id, [runId]))
    .run();

  return {
    runId,
    status,
    totalFound: collected.length,
    totalNew: rows.length,
    perSource,
  };
}
