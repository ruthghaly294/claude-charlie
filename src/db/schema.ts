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

/** Observe: a distilled insight over a cluster of signals. */
export const insights = sqliteTable(
  "insights",
  {
    id: text("id").primaryKey(),
    cluster: text("cluster").notNull().default("unclustered"),
    trend: text("trend").notNull(),
    importance: text("importance", { enum: ["high", "medium", "low"] })
      .notNull()
      .default("medium"),
    body: text("body").notNull().default(""),
    evidence: text("evidence", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("insights_cluster_idx").on(t.cluster)],
);

/** Decide: a prioritized recommendation derived from insights. */
export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    lane: text("lane", {
      enum: ["product", "content", "marketing", "strategic"],
    })
      .notNull()
      .default("content"),
    title: text("title").notNull(),
    impact: text("impact", { enum: ["high", "medium", "low"] })
      .notNull()
      .default("medium"),
    effort: text("effort", { enum: ["high", "medium", "low"] })
      .notNull()
      .default("medium"),
    priority: real("priority").notNull().default(0),
    rationale: text("rationale").notNull().default(""),
    fromInsights: text("from_insights", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    status: text("status", { enum: ["open", "done"] })
      .notNull()
      .default("open"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("decisions_priority_idx").on(t.priority)],
);

/** Execute: a drafted asset for a top decision. */
export const executions = sqliteTable("executions", {
  id: text("id").primaryKey(),
  decisionId: text("decision_id"),
  lane: text("lane").notNull().default("content"),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  status: text("status", { enum: ["draft", "published"] })
    .notNull()
    .default("draft"),
  createdAt: text("created_at").notNull(),
});

/** Feedback: per-keyword performance multiplier consumed by curate/scoring. */
export const rankings = sqliteTable("rankings", {
  keyword: text("keyword").primaryKey(),
  multiplier: real("multiplier").notNull().default(1),
  value: real("value").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export type Signal = typeof signals.$inferSelect;
export type NewSignal = typeof signals.$inferInsert;
export type DiscoveryRun = typeof discoveryRuns.$inferSelect;
export type NewDiscoveryRun = typeof discoveryRuns.$inferInsert;
export type Insight = typeof insights.$inferSelect;
export type NewInsight = typeof insights.$inferInsert;
export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;
export type Execution = typeof executions.$inferSelect;
export type NewExecution = typeof executions.$inferInsert;
export type Ranking = typeof rankings.$inferSelect;
