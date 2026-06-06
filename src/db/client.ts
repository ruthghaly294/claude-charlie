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
 * Kept in sync with schema.ts by hand — there are only two tables.
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
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rankings (
      keyword TEXT PRIMARY KEY,
      multiplier REAL NOT NULL DEFAULT 1,
      value REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
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
