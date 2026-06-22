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

    CREATE TABLE IF NOT EXISTS extraction_cache (
      html_hash TEXT PRIMARY KEY,
      url TEXT NOT NULL DEFAULT '',
      fields TEXT NOT NULL DEFAULT '{}',
      model TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rankings (
      keyword TEXT PRIMARY KEY,
      multiplier REAL NOT NULL DEFAULT 1,
      value REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      keyword TEXT NOT NULL,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      source TEXT NOT NULL DEFAULT 'seed',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS entities_keyword_idx ON entities(keyword);
    CREATE INDEX IF NOT EXISTS entities_status_idx ON entities(status);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      run_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_status_run_at_idx ON jobs(status, run_at);

    CREATE TABLE IF NOT EXISTS job_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL,
      processed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS events_status_idx ON events(status);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      event_id TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      sent_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notifications_status_idx ON notifications(status);

    CREATE TABLE IF NOT EXISTS published_posts (
      id TEXT PRIMARY KEY,
      buffer_post_id TEXT,
      channel_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      topic TEXT NOT NULL,
      item_url TEXT NOT NULL,
      item_title TEXT NOT NULL,
      keyword TEXT,
      text TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_metrics_at TEXT,
      metrics TEXT
    );
    CREATE INDEX IF NOT EXISTS published_posts_item_url_idx ON published_posts(item_url);
    CREATE INDEX IF NOT EXISTS published_posts_buffer_post_id_idx ON published_posts(buffer_post_id);

    CREATE TABLE IF NOT EXISTS music_tracks (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      trend_title TEXT NOT NULL,
      trend_url TEXT NOT NULL DEFAULT '',
      where_trending TEXT NOT NULL DEFAULT '',
      engagement INTEGER NOT NULL DEFAULT 0,
      mood TEXT NOT NULL DEFAULT 'neutral',
      energy TEXT NOT NULL DEFAULT 'medium',
      native_sound_id TEXT,
      provider TEXT NOT NULL DEFAULT '',
      safe_search_query TEXT NOT NULL DEFAULT '',
      safe_track_url TEXT,
      licence TEXT NOT NULL DEFAULT 'royalty-free',
      embeddable INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS music_tracks_topic_idx ON music_tracks(topic);
    CREATE TABLE IF NOT EXISTS research_cache (
      topic TEXT PRIMARY KEY,
      report TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generated_videos (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      brief TEXT,
      exemplars TEXT,
      sound_track_url TEXT,
      sound_mood TEXT,
      cover_image_url TEXT,
      video_url TEXT NOT NULL,
      slide_urls TEXT,
      format TEXT NOT NULL DEFAULT 'trend-video',
      virality_score INTEGER,
      virality_report_url TEXT,
      status TEXT NOT NULL,
      buffer_post_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS generated_videos_topic_idx ON generated_videos(topic);

    CREATE TABLE IF NOT EXISTS exam_questions (
      id TEXT PRIMARY KEY,
      subtopic TEXT NOT NULL,
      statement TEXT NOT NULL,
      correct_answer INTEGER NOT NULL,
      explanation TEXT NOT NULL,
      difficulty TEXT,
      source TEXT,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS exam_questions_subtopic_idx ON exam_questions(subtopic, used_at);

    CREATE TABLE IF NOT EXISTS trend_runs (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      mode TEXT NOT NULL,
      asset_style TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      stages TEXT NOT NULL DEFAULT '[]',
      generated_video_id TEXT,
      error TEXT,
      review_enabled INTEGER NOT NULL DEFAULT 0,
      render_context TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS trend_runs_created_idx ON trend_runs(created_at);

    CREATE TABLE IF NOT EXISTS prompt_overrides (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_variants (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      template TEXT NOT NULL,
      builtin INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS prompt_variants_key_idx ON prompt_variants(key);

    CREATE TABLE IF NOT EXISTS notebooklm_settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      enabled INTEGER NOT NULL DEFAULT 0,
      mode TEXT NOT NULL DEFAULT 'discovery',
      notebook_id TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS seo_sites (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      domain TEXT NOT NULL,
      competitors TEXT NOT NULL DEFAULT '[]',
      keywords TEXT NOT NULL DEFAULT '[]',
      max_pages INTEGER NOT NULL DEFAULT 40,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seo_audits (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      scores TEXT,
      new_rec_count INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS seo_audits_site_idx ON seo_audits(site_id);

    CREATE TABLE IF NOT EXISTS seo_pages (
      id TEXT PRIMARY KEY,
      audit_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'self',
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      meta_description TEXT NOT NULL DEFAULT '',
      canonical TEXT NOT NULL DEFAULT '',
      h1s TEXT NOT NULL DEFAULT '[]',
      json_ld_types TEXT NOT NULL DEFAULT '[]',
      word_count INTEGER NOT NULL DEFAULT 0,
      seo_issues TEXT NOT NULL DEFAULT '[]',
      geo_issues TEXT NOT NULL DEFAULT '[]',
      seo_score REAL NOT NULL DEFAULT 0,
      geo_score REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS seo_pages_audit_idx ON seo_pages(audit_id);

    CREATE TABLE IF NOT EXISTS seo_trends (
      id TEXT PRIMARY KEY,
      audit_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      term TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      momentum REAL NOT NULL DEFAULT 0,
      on_self INTEGER NOT NULL DEFAULT 0,
      on_competitors TEXT NOT NULL DEFAULT '[]',
      gap INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS seo_trends_audit_idx ON seo_trends(audit_id);

    CREATE TABLE IF NOT EXISTS seo_recommendations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'seo',
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      execution_steps TEXT NOT NULL DEFAULT '[]',
      impact TEXT NOT NULL DEFAULT 'medium',
      effort TEXT NOT NULL DEFAULT 'medium',
      evidence TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open',
      first_seen_audit_id TEXT NOT NULL,
      last_seen_audit_id TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      missed_runs INTEGER NOT NULL DEFAULT 0,
      done_at TEXT
    );
    CREATE INDEX IF NOT EXISTS seo_recs_site_status_idx ON seo_recommendations(site_id, status);
    CREATE INDEX IF NOT EXISTS seo_recs_fingerprint_idx ON seo_recommendations(fingerprint);

    CREATE TABLE IF NOT EXISTS seo_rankings (
      id TEXT PRIMARY KEY,
      audit_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      engine TEXT NOT NULL DEFAULT 'searxng',
      position INTEGER,
      url TEXT NOT NULL DEFAULT '',
      competitors_ahead TEXT NOT NULL DEFAULT '[]',
      captured_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS seo_rankings_site_idx ON seo_rankings(site_id);
    CREATE INDEX IF NOT EXISTS seo_rankings_audit_idx ON seo_rankings(audit_id);
  `);

  // Lightweight migrations: add columns that older DBs (created before a column
  // existed) are missing. CREATE TABLE IF NOT EXISTS won't add them, so we do.
  ensureColumns(sqlite, "decisions", [
    "confidence TEXT NOT NULL DEFAULT 'medium'",
    "value REAL NOT NULL DEFAULT 0",
    "updated_at TEXT",
    "expires_at TEXT",
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
    "address_key TEXT",
  ]);
  sqlite.exec(
    `CREATE INDEX IF NOT EXISTS listings_address_key_idx ON listings(address_key)`,
  );
  ensureColumns(sqlite, "signals", [
    "points INTEGER",
    "comments INTEGER",
    "views INTEGER",
    "social_score REAL",
    "author_key TEXT",
  ]);
  ensureColumns(sqlite, "trend_runs", [
    "review_enabled INTEGER NOT NULL DEFAULT 0",
    "render_context TEXT",
  ]);
  ensureColumns(sqlite, "music_tracks", ["native_sound_id TEXT"]);
  ensureColumns(sqlite, "generated_videos", [
    "slide_urls TEXT",
    "format TEXT NOT NULL DEFAULT 'trend-video'",
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
