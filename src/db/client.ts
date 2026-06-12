import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

/**
 * Idempotent schema creation. We use CREATE TABLE IF NOT EXISTS (rather than a
 * migration step) so the app and tests are always runnable with zero setup.
 * Kept in sync with schema.ts by hand across all tables (signals,
 * discovery_runs, insights, decisions, executions, rankings, decode_runs).
 */
export function ensureSchema(sqlite: Database.Database): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      url_hash TEXT NOT NULL UNIQUE,
      author TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL DEFAULT '',
      raw TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      score REAL,
      cluster TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      captured_at TEXT NOT NULL,
      run_id TEXT
    );
    CREATE INDEX IF NOT EXISTS signals_source_idx ON signals(source);
    CREATE INDEX IF NOT EXISTS signals_status_idx ON signals(status);
    CREATE INDEX IF NOT EXISTS signals_captured_idx ON signals(captured_at);

    CREATE TABLE IF NOT EXISTS discovery_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      total_found INTEGER NOT NULL DEFAULT 0,
      total_new INTEGER NOT NULL DEFAULT 0,
      per_source TEXT NOT NULL DEFAULT '[]',
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS insights (
      id TEXT PRIMARY KEY,
      cluster TEXT NOT NULL DEFAULT 'unclustered',
      trend TEXT NOT NULL,
      importance TEXT NOT NULL DEFAULT 'medium',
      body TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS insights_cluster_idx ON insights(cluster);

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      lane TEXT NOT NULL DEFAULT 'content',
      title TEXT NOT NULL,
      impact TEXT NOT NULL DEFAULT 'medium',
      effort TEXT NOT NULL DEFAULT 'medium',
      confidence TEXT NOT NULL DEFAULT 'medium',
      value REAL NOT NULL DEFAULT 0,
      priority REAL NOT NULL DEFAULT 0,
      rationale TEXT NOT NULL DEFAULT '',
      from_insights TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS decisions_priority_idx ON decisions(priority);

    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      decision_id TEXT,
      lane TEXT NOT NULL DEFAULT 'content',
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      quality_score REAL NOT NULL DEFAULT 0,
      quality_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS decode_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      stages TEXT NOT NULL DEFAULT '[]',
      digest TEXT,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      execution_id TEXT,
      format TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS postcode_values (
      postcode TEXT PRIMARY KEY,
      longitude REAL,
      latitude REAL,
      n_properties INTEGER NOT NULL DEFAULT 0,
      mean_val REAL NOT NULL DEFAULT 0,
      mean_size REAL NOT NULL DEFAULT 0,
      mean_ppsqm REAL NOT NULL DEFAULT 0,
      ppsqm_delta REAL NOT NULL DEFAULT 0,
      quarter TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS valuation_coefs (
      coef TEXT PRIMARY KEY,
      value_mean REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'propertypal',
      area TEXT NOT NULL DEFAULT 'unknown',
      address TEXT NOT NULL DEFAULT '',
      street TEXT NOT NULL DEFAULT '',
      postcode TEXT NOT NULL DEFAULT '',
      property_type TEXT NOT NULL DEFAULT '',
      beds INTEGER,
      size_sqm REAL,
      asking_price REAL NOT NULL DEFAULT 0,
      url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      fair_value REAL,
      deal_pct REAL,
      deal_score REAL NOT NULL DEFAULT 0,
      valuation_basis TEXT NOT NULL DEFAULT '',
      latitude REAL,
      longitude REAL,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS listings_area_idx ON listings(area);
    CREATE INDEX IF NOT EXISTS listings_deal_idx ON listings(deal_score);

    CREATE TABLE IF NOT EXISTS listing_snapshots (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      asking_price REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS snapshots_listing_idx ON listing_snapshots(listing_id);

    CREATE TABLE IF NOT EXISTS lps_properties (
      property_id TEXT PRIMARY KEY,
      postcode TEXT NOT NULL DEFAULT '',
      full_address TEXT NOT NULL DEFAULT '',
      capital_value REAL,
      size_sqm REAL,
      has_garage INTEGER NOT NULL DEFAULT 0,
      has_garden INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      fetched_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS lps_postcode_idx ON lps_properties(postcode);

    CREATE TABLE IF NOT EXISTS geocode_cache (
      query TEXT PRIMARY KEY,
      postcode TEXT NOT NULL DEFAULT '',
      latitude REAL,
      longitude REAL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rankings (
      keyword TEXT PRIMARY KEY,
      multiplier REAL NOT NULL DEFAULT 1,
      value REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_health (
      source TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'closed',
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      open_until TEXT,
      last_success_at TEXT,
      last_error_at TEXT,
      last_error TEXT,
      avg_latency_ms REAL NOT NULL DEFAULT 0,
      total_runs INTEGER NOT NULL DEFAULT 0,
      total_failures INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);

  // Lightweight migrations: add columns that older DBs (created before a column
  // existed) are missing. CREATE TABLE IF NOT EXISTS won't add them, so we do.
  ensureColumns(sqlite, "decisions", [
    "confidence TEXT NOT NULL DEFAULT 'medium'",
    "value REAL NOT NULL DEFAULT 0",
  ]);
  ensureColumns(sqlite, "executions", [
    "quality_score REAL NOT NULL DEFAULT 0",
    "quality_notes TEXT NOT NULL DEFAULT ''",
  ]);
  ensureColumns(sqlite, "listings", [
    "valuation_basis TEXT NOT NULL DEFAULT ''",
    "latitude REAL",
    "longitude REAL",
    "size_source TEXT NOT NULL DEFAULT ''",
    "lps_property_id TEXT",
    "lps_capital_value REAL",
  ]);
}

/** Add any of `defs` (column DDL) that the table doesn't already have. */
function ensureColumns(
  sqlite: Database.Database,
  table: string,
  defs: string[],
): void {
  const cols = new Set(
    sqlite
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((r) => (r as { name: string }).name),
  );
  for (const def of defs) {
    const name = def.split(/\s+/)[0]!;
    if (!cols.has(name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
  }
}

/** Create a fresh drizzle DB over a sqlite file (or :memory: for tests). */
export function createDb(filename: string): DB {
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const sqlite = new Database(filename);
  ensureSchema(sqlite);
  return drizzle(sqlite, { schema });
}

let _db: DB | undefined;

/** Process-wide singleton for the Next.js server, pointed at DECODE_DB_PATH. */
export function getDb(): DB {
  if (!_db) {
    const path = process.env.DECODE_DB_PATH ?? "data/decode.db";
    _db = createDb(path);
  }
  return _db;
}
