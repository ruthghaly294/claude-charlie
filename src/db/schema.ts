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

export type StageResult = {
  stage: string;
  durationMs: number;
  count: number;
};

/** One full DECODE loop run — telemetry, token spend, and cost for observability. */
export const decodeRuns = sqliteTable("decode_runs", {
  id: text("id").primaryKey(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status", { enum: ["running", "ok", "error"] })
    .notNull()
    .default("running"),
  stages: text("stages", { mode: "json" })
    .$type<StageResult[]>()
    .notNull()
    .default(sql`'[]'`),
  digest: text("digest", { mode: "json" }).$type<unknown>(),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  error: text("error"),
});

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
    confidence: text("confidence", { enum: ["high", "medium", "low"] })
      .notNull()
      .default("medium"),
    value: real("value").notNull().default(0),
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
  status: text("status", { enum: ["draft", "ready", "published"] })
    .notNull()
    .default("draft"),
  qualityScore: real("quality_score").notNull().default(0),
  qualityNotes: text("quality_notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

/** Package: a sellable product derived from a "ready" execution, per format. */
export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  executionId: text("execution_id"),
  format: text("format", {
    enum: ["newsletter", "download", "thread", "file"],
  }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  price: real("price").notNull().default(0),
  status: text("status", { enum: ["draft", "published"] })
    .notNull()
    .default("draft"),
  createdAt: text("created_at").notNull(),
});

/* ─────────────────────────  Property intelligence  ───────────────────────── */

/** LPS-modelled value per postcode (from nihousepricemap.com), the fair-value baseline. */
export const postcodeValues = sqliteTable("postcode_values", {
  postcode: text("postcode").primaryKey(),
  longitude: real("longitude"),
  latitude: real("latitude"),
  nProperties: integer("n_properties").notNull().default(0),
  meanVal: real("mean_val").notNull().default(0),
  meanSize: real("mean_size").notNull().default(0),
  meanPpsqm: real("mean_ppsqm").notNull().default(0),
  ppsqmDelta: real("ppsqm_delta").notNull().default(0),
  quarter: text("quarter").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

/** Calculator coefficients: per-postcode base £/m² + global feature adjustments. */
export const valuationCoefs = sqliteTable("valuation_coefs", {
  coef: text("coef").primaryKey(),
  valueMean: real("value_mean").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

/** A property listing tracked over time (manually/assisted-imported from PropertyPal). */
export const listings = sqliteTable(
  "listings",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull().default("propertypal"),
    area: text("area").notNull().default("unknown"),
    address: text("address").notNull().default(""),
    street: text("street").notNull().default(""),
    postcode: text("postcode").notNull().default(""),
    propertyType: text("property_type").notNull().default(""),
    beds: integer("beds"),
    sizeSqm: real("size_sqm"),
    askingPrice: real("asking_price").notNull().default(0),
    url: text("url").notNull().default(""),
    status: text("status", { enum: ["active", "sstc", "sold", "gone"] })
      .notNull()
      .default("active"),
    fairValue: real("fair_value"),
    dealPct: real("deal_pct"),
    dealScore: real("deal_score").notNull().default(0),
    firstSeen: text("first_seen").notNull(),
    lastSeen: text("last_seen").notNull(),
  },
  (t) => [
    index("listings_area_idx").on(t.area),
    index("listings_deal_idx").on(t.dealScore),
  ],
);

/** Asking-price/status history per listing — the longitudinal record. */
export const listingSnapshots = sqliteTable(
  "listing_snapshots",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id").notNull(),
    askingPrice: real("asking_price").notNull().default(0),
    status: text("status").notNull().default("active"),
    seenAt: text("seen_at").notNull(),
  },
  (t) => [index("snapshots_listing_idx").on(t.listingId)],
);

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
export type DecodeRun = typeof decodeRuns.$inferSelect;
export type NewDecodeRun = typeof decodeRuns.$inferInsert;
export type Insight = typeof insights.$inferSelect;
export type NewInsight = typeof insights.$inferInsert;
export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;
export type Execution = typeof executions.$inferSelect;
export type NewExecution = typeof executions.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type PostcodeValue = typeof postcodeValues.$inferSelect;
export type NewPostcodeValue = typeof postcodeValues.$inferInsert;
export type ValuationCoef = typeof valuationCoefs.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
export type ListingSnapshot = typeof listingSnapshots.$inferSelect;
export type Ranking = typeof rankings.$inferSelect;
