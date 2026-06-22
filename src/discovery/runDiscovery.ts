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
import type { Connector, RawSignal } from "./types";
import { CONNECTORS } from "./connectors";
import { hashKey, scoreSignal, slugify } from "./scoring";
import { socialPercentiles, applySocialBoost } from "./socialScore";
import { mergeClusters, applyAuthorCap } from "./clusterMerge";
import { seedEntities } from "./research";
import type { DecodeConfig } from "./config";
import { runSources } from "./sourceRunner";
import { emit } from "@/events/bus";

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

  seedEntities(db, config.seedEntities);

  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  db.insert(discoveryRuns)
    .values({ id: runId, startedAt, status: "running" })
    .run();

  const { perSource, collected } = await runSources(db, config, connectors, {
    fetchImpl,
    env,
    signal,
  });

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

  const candidates: { hash: string; raw: RawSignal; keywordScore: number; cluster: string }[] = [];
  for (const [h, s] of byHash) {
    if (existing.has(h)) continue;
    const { score, cluster } = scoreSignal(
      `${s.title} ${s.raw}`,
      config.keywords,
      multipliers,
      s.source,
    );
    candidates.push({ hash: h, raw: s, keywordScore: score, cluster });
  }

  const socialPercentile = socialPercentiles(
    candidates.map((c) => ({
      source: c.raw.source,
      points: c.raw.points,
      comments: c.raw.comments,
      views: c.raw.views,
    })),
  );

  type ScoredRow = Omit<NewSignal, "cluster" | "authorKey"> & {
    cluster: string;
    authorKey: string | null;
  };

  let rows: ScoredRow[] = candidates.map((c, i) => {
    const social = socialPercentile[i]!;
    const score = applySocialBoost(c.keywordScore, social);
    return {
      id: randomUUID(),
      source: c.raw.source,
      title: c.raw.title,
      url: c.raw.url,
      urlHash: c.hash,
      author: c.raw.author,
      publishedAt: c.raw.publishedAt,
      raw: c.raw.raw,
      tags: c.raw.tags,
      score,
      cluster: c.cluster,
      status: score >= config.keepThreshold ? "new" : "archived",
      capturedAt,
      runId,
      points: c.raw.points ?? null,
      comments: c.raw.comments ?? null,
      views: c.raw.views ?? null,
      socialScore: social,
      authorKey: c.raw.authorKey ?? null,
    };
  });

  // cross-source cluster merge (title-similarity), then drop per-author excess
  rows = mergeClusters(rows);
  rows = applyAuthorCap(rows, config.research.perAuthorCap);

  const addedBySource = new Map<string, number>();
  for (const r of rows) {
    addedBySource.set(r.source, (addedBySource.get(r.source) ?? 0) + 1);
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

  if (status === "error") {
    const error = perSource
      .filter((p) => p.status === "error")
      .map((p) => `${p.source}: ${p.error}`)
      .join("; ");
    emit(db, "discovery.run_failed", { runId, error });
  }

  return {
    runId,
    status,
    totalFound: collected.length,
    totalNew: rows.length,
    perSource,
  };
}
