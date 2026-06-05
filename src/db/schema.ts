import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from "drizzle-orm/sqlite-core";

/**
 * One discovered signal. `urlHash` is the dedup key (sha1 of url || title).
 */
export const signals = sqliteTable(
  "signals",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull().default(""),
    urlHash: text("url_hash").notNull().unique(),
    author: text("author").notNull().default(""),
    publishedAt: text("published_at").notNull().default(""),
    raw: text("raw").notNull().default(""),
    tags: text("tags", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    score: real("score"),
    cluster: text("cluster"),
    status: text("status", { enum: ["new", "curated", "archived"] })
      .notNull()
      .default("new"),
    capturedAt: text("captured_at").notNull(),
    runId: text("run_id"),
  },
  (t) => [
    index("signals_source_idx").on(t.source),
    index("signals_status_idx").on(t.status),
    index("signals_captured_idx").on(t.capturedAt),
  ],
);

/**
 * One discovery run (an invocation of runDiscovery), for status/auditing.
 */
export const discoveryRuns = sqliteTable("discovery_runs", {
  id: text("id").primaryKey(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status", { enum: ["running", "ok", "partial", "error"] })
    .notNull()
    .default("running"),
  totalFound: integer("total_found").notNull().default(0),
  totalNew: integer("total_new").notNull().default(0),
  perSource: text("per_source", { mode: "json" })
    .$type<SourceRunResult[]>()
    .notNull()
    .default(sql`'[]'`),
  error: text("error"),
});

export type SourceRunResult = {
  source: string;
  status: "ok" | "skipped" | "error";
  found: number;
  added: number;
  durationMs: number;
  error?: string;
};

export type Signal = typeof signals.$inferSelect;
export type NewSignal = typeof signals.$inferInsert;
export type DiscoveryRun = typeof discoveryRuns.$inferSelect;
export type NewDiscoveryRun = typeof discoveryRuns.$inferInsert;
