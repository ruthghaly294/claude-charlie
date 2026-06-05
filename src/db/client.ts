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
