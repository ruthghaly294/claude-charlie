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
    /** raw engagement metrics from the source API, where available */
    points: integer("points"),
    comments: integer("comments"),
    views: integer("views"),
    /** per-source percentile-normalized engagement, used to boost keywordScore */
    socialScore: real("social_score"),
    /** normalized "source:author" — used for the per-author cap in clusterMerge */
    authorKey: text("author_key"),
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

/**
 * A resolved research target — a subreddit, GitHub topic, YouTube query,
 * author, hashtag, or feed — used to expand keyword queries into
 * per-connector query plans (see discovery/research.ts).
 */
export const entities = sqliteTable(
  "entities",
  {
    id: text("id").primaryKey(),
    keyword: text("keyword").notNull(),
    kind: text("kind", {
      enum: ["subreddit", "github_topic", "youtube_query", "author", "hashtag", "feed"],
    }).notNull(),
    value: text("value").notNull(),
    weight: real("weight").notNull().default(1),
    status: text("status", { enum: ["active", "proposed", "rejected"] })
      .notNull()
      .default("active"),
    source: text("source", { enum: ["seed", "claude", "manual"] })
      .notNull()
      .default("seed"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("entities_keyword_idx").on(t.keyword),
    index("entities_status_idx").on(t.status),
  ],
);

/**
 * A scheduled/queued unit of work for the job runner (src/jobs/runner.ts).
 * `runAt` is when it next becomes eligible to run; failed attempts reschedule
 * it with backoff until `maxAttempts`, after which it's marked "dead".
 */
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull().default(sql`'{}'`),
    status: text("status", { enum: ["pending", "running", "ok", "failed", "dead"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: text("run_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("jobs_status_run_at_idx").on(t.status, t.runAt)],
);

/** One execution attempt of a job — the n8n-style execution history. */
export const jobRuns = sqliteTable("job_runs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  kind: text("kind").notNull(),
  attempt: integer("attempt").notNull().default(1),
  status: text("status", { enum: ["ok", "failed"] }).notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at").notNull(),
  durationMs: integer("duration_ms").notNull().default(0),
  error: text("error"),
});

/**
 * An emitted domain event (e.g. "listing.price_drop", "decode.insight_created"),
 * consumed by the events-process job (src/events/bus.ts) to fan out notifications.
 */
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull().default(sql`'{}'`),
    status: text("status", { enum: ["new", "processed", "failed"] })
      .notNull()
      .default("new"),
    createdAt: text("created_at").notNull(),
    processedAt: text("processed_at"),
  },
  (t) => [index("events_status_idx").on(t.status)],
);

/**
 * A delivery attempt of a notification to one channel for one event — audit
 * trail + retry bookkeeping for src/notify/*.
 */
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    channel: text("channel").notNull(),
    eventId: text("event_id"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    status: text("status", { enum: ["pending", "sent", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    sentAt: text("sent_at"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("notifications_status_idx").on(t.status)],
);

export type SourceRunResult = {
  source: string;
  status: "ok" | "skipped" | "error";
  found: number;
  added: number;
  durationMs: number;
  error?: string;
};

/**
 * Per-connector health/circuit-breaker state, persisted across runs so a
 * source that's been failing stays skipped ("breaker open") until its
 * cooldown elapses, instead of being retried (and timing out) every run.
 */
export const sourceHealth = sqliteTable("source_health", {
  source: text("source").primaryKey(),
  state: text("state", { enum: ["closed", "open", "half-open"] })
    .notNull()
    .default("closed"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  openUntil: text("open_until"),
  lastSuccessAt: text("last_success_at"),
  lastErrorAt: text("last_error_at"),
  lastError: text("last_error"),
  avgLatencyMs: real("avg_latency_ms").notNull().default(0),
  totalRuns: integer("total_runs").notNull().default(0),
  totalFailures: integer("total_failures").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

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
    status: text("status", { enum: ["open", "done", "expired", "reopened"] })
      .notNull()
      .default("open"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at"),
    /** ttl deadline (createdAt + decisions.ttl_days); past this, an "open" decision expires. */
    expiresAt: text("expires_at"),
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

/**
 * Per-address facts from the public LPS valuation list (real floor area,
 * garage/garden, 2005 capital value). A lookup cache — one row per LPS record.
 */
export const lpsProperties = sqliteTable(
  "lps_properties",
  {
    propertyId: text("property_id").primaryKey(),
    postcode: text("postcode").notNull().default(""),
    fullAddress: text("full_address").notNull().default(""),
    capitalValue: real("capital_value"),
    sizeSqm: real("size_sqm"),
    hasGarage: integer("has_garage").notNull().default(0),
    hasGarden: integer("has_garden").notNull().default(0),
    description: text("description").notNull().default(""),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [index("lps_postcode_idx").on(t.postcode)],
);

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
    valuationBasis: text("valuation_basis").notNull().default(""),
    sizeSource: text("size_source").notNull().default(""),
    lpsPropertyId: text("lps_property_id"),
    lpsCapitalValue: real("lps_capital_value"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    /** normalized "postcode|address" — same property via a different agent/URL shares this key */
    addressKey: text("address_key"),
    firstSeen: text("first_seen").notNull(),
    lastSeen: text("last_seen").notNull(),
  },
  (t) => [
    index("listings_area_idx").on(t.area),
    index("listings_deal_idx").on(t.dealScore),
    index("listings_address_key_idx").on(t.addressKey),
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

/** Cache of address → postcode/coords lookups (avoids re-hitting the geocoder). */
export const geocodeCache = sqliteTable("geocode_cache", {
  query: text("query").primaryKey(),
  postcode: text("postcode").notNull().default(""),
  latitude: real("latitude"),
  longitude: real("longitude"),
  fetchedAt: text("fetched_at").notNull(),
});

/** Cache of LLM-repaired extraction fields, keyed by sha1(html) — avoids re-asking Claude for the same page. */
export const extractionCache = sqliteTable("extraction_cache", {
  htmlHash: text("html_hash").primaryKey(),
  url: text("url").notNull().default(""),
  fields: text("fields").notNull().default("{}"),
  model: text("model").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

/**
 * Provenance + status + metrics for every post created via
 * /api/buffer/posts — the local record of what we generated, where it went,
 * and what topic/keyword it came from (Buffer itself doesn't track this).
 */
export const publishedPosts = sqliteTable(
  "published_posts",
  {
    id: text("id").primaryKey(),
    bufferPostId: text("buffer_post_id"),
    channelId: text("channel_id").notNull(),
    platform: text("platform", {
      enum: ["x", "reddit", "instagram", "facebook"],
    }).notNull(),
    topic: text("topic").notNull(),
    itemUrl: text("item_url").notNull(),
    itemTitle: text("item_title").notNull(),
    keyword: text("keyword"),
    text: text("text").notNull(),
    status: text("status", {
      enum: ["draft", "needs_approval", "scheduled", "sending", "sent", "error"],
    }).notNull(),
    createdAt: text("created_at").notNull(),
    lastMetricsAt: text("last_metrics_at"),
    metrics: text("metrics", { mode: "json" }).$type<Record<string, number>>(),
  },
  (t) => [
    index("published_posts_item_url_idx").on(t.itemUrl),
    index("published_posts_buffer_post_id_idx").on(t.bufferPostId),
  ],
);

/** Feedback: per-keyword performance multiplier consumed by curate/scoring. */
export const rankings = sqliteTable("rankings", {
  keyword: text("keyword").primaryKey(),
  multiplier: real("multiplier").notNull().default(1),
  value: real("value").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

/* ─────────────────────────  SEO / GEO assistant  ───────────────────────── */

export type SeoScores = {
  seo: number;
  geo: number;
  competitor: number;
  overall: number;
};

export type SeoIssue = {
  code: string;
  message: string;
  impact: "high" | "medium" | "low";
};

/**
 * A tracked website (multi-site so the assistant extends to any project, not
 * just the first example). Seeded from decode.config.yml's seo.sites and/or
 * created via the /seo dashboard.
 */
export const seoSites = sqliteTable("seo_sites", {
  id: text("id").primaryKey(),
  label: text("label").notNull().default(""),
  domain: text("domain").notNull(),
  competitors: text("competitors", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  keywords: text("keywords", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  maxPages: integer("max_pages").notNull().default(40),
  createdAt: text("created_at").notNull(),
});

/** One audit run for a site — the unit a weekly schedule (or button) produces. */
export const seoAudits = sqliteTable(
  "seo_audits",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    status: text("status", { enum: ["running", "ok", "partial", "error"] })
      .notNull()
      .default("running"),
    scores: text("scores", { mode: "json" }).$type<SeoScores>(),
    newRecCount: integer("new_rec_count").notNull().default(0),
    summary: text("summary").notNull().default(""),
    error: text("error"),
  },
  (t) => [index("seo_audits_site_idx").on(t.siteId)],
);

/** Per-page crawl metrics + detected on-page SEO/GEO issues for one audit. */
export const seoPages = sqliteTable(
  "seo_pages",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id").notNull(),
    siteId: text("site_id").notNull(),
    role: text("role", { enum: ["self", "competitor"] })
      .notNull()
      .default("self"),
    url: text("url").notNull(),
    title: text("title").notNull().default(""),
    metaDescription: text("meta_description").notNull().default(""),
    canonical: text("canonical").notNull().default(""),
    h1s: text("h1s", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    jsonLdTypes: text("json_ld_types", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    wordCount: integer("word_count").notNull().default(0),
    seoIssues: text("seo_issues", { mode: "json" })
      .$type<SeoIssue[]>()
      .notNull()
      .default(sql`'[]'`),
    geoIssues: text("geo_issues", { mode: "json" })
      .$type<SeoIssue[]>()
      .notNull()
      .default(sql`'[]'`),
    seoScore: real("seo_score").notNull().default(0),
    geoScore: real("geo_score").notNull().default(0),
  },
  (t) => [index("seo_pages_audit_idx").on(t.auditId)],
);

/** A trending term per audit, flagged with whether you / competitors use it. */
export const seoTrends = sqliteTable(
  "seo_trends",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id").notNull(),
    siteId: text("site_id").notNull(),
    term: text("term").notNull(),
    source: text("source").notNull().default(""),
    momentum: real("momentum").notNull().default(0),
    onSelf: integer("on_self", { mode: "boolean" }).notNull().default(false),
    onCompetitors: text("on_competitors", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    gap: integer("gap", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("seo_trends_audit_idx").on(t.auditId)],
);

/**
 * The durable to-do list — the heart of the weekly loop. Each candidate is
 * keyed by a stable `fingerprint`; re-running an audit upserts by fingerprint
 * so a fixed/dismissed item never re-nags and only genuinely-new gaps appear as
 * NEW (firstSeenAuditId === latest audit).
 */
export const seoRecommendations = sqliteTable(
  "seo_recommendations",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull(),
    fingerprint: text("fingerprint").notNull().unique(),
    category: text("category", {
      enum: ["seo", "geo", "content", "technical", "trend-gap", "competitor-gap"],
    })
      .notNull()
      .default("seo"),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    executionSteps: text("execution_steps", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    impact: text("impact", { enum: ["high", "medium", "low"] })
      .notNull()
      .default("medium"),
    effort: text("effort", { enum: ["high", "medium", "low"] })
      .notNull()
      .default("medium"),
    evidence: text("evidence", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    status: text("status", { enum: ["open", "done", "dismissed", "reopened"] })
      .notNull()
      .default("open"),
    firstSeenAuditId: text("first_seen_audit_id").notNull(),
    lastSeenAuditId: text("last_seen_audit_id").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    missedRuns: integer("missed_runs").notNull().default(0),
    doneAt: text("done_at"),
  },
  (t) => [
    index("seo_recs_site_status_idx").on(t.siteId, t.status),
    index("seo_recs_fingerprint_idx").on(t.fingerprint),
  ],
);

/**
 * Per-keyword SERP position captured each audit (Serposcope-style rank
 * tracking, built on our own schema — sourced from a self-hosted SearXNG/
 * OpenSERP instance via the `serp` provider, never from their code). Lets the
 * dashboard chart movement and flag competitors outranking you over time.
 */
export const seoRankings = sqliteTable(
  "seo_rankings",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id").notNull(),
    siteId: text("site_id").notNull(),
    keyword: text("keyword").notNull(),
    engine: text("engine").notNull().default("searxng"),
    /** our domain's best position for the keyword; null = not in the sampled results */
    position: integer("position"),
    url: text("url").notNull().default(""),
    competitorsAhead: text("competitors_ahead", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    capturedAt: text("captured_at").notNull(),
  },
  (t) => [
    index("seo_rankings_site_idx").on(t.siteId),
    index("seo_rankings_audit_idx").on(t.auditId),
  ],
);

/* ─────────────────────────  Trend-imitation engine  ───────────────────────── */

/**
 * Reusable trending-music library. Each row is *trend evidence* plus the
 * legally-safe substitute we actually use (`safeTrackUrl`, royalty-free/CC).
 * The commercial trend track itself is never embedded into generated media.
 */
export const musicTracks = sqliteTable(
  "music_tracks",
  {
    id: text("id").primaryKey(),
    topic: text("topic").notNull(),
    trendTitle: text("trend_title").notNull(),
    trendUrl: text("trend_url").notNull().default(""),
    whereTrending: text("where_trending").notNull().default(""),
    engagement: integer("engagement").notNull().default(0),
    mood: text("mood").notNull().default("neutral"),
    energy: text("energy", { enum: ["low", "medium", "high"] })
      .notNull()
      .default("medium"),
    nativeSoundId: text("native_sound_id"),
    provider: text("provider").notNull().default(""),
    safeSearchQuery: text("safe_search_query").notNull().default(""),
    safeTrackUrl: text("safe_track_url"),
    licence: text("licence").notNull().default("royalty-free"),
    embeddable: integer("embeddable", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("music_tracks_topic_idx").on(t.topic)],
);

/**
 * Cache of raw last30days research reports, keyed by normalized topic, so
 * re-running a topic within the TTL skips the slow (~240s) research CLI and
 * reuses the prior pull. `report` holds the full ResearchReport JSON.
 */
export const researchCache = sqliteTable("research_cache", {
  topic: text("topic").primaryKey(),
  report: text("report", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
  createdAt: text("created_at").notNull(),
});

/**
 * A generated short-form video and the full imitate→innovate context behind it:
 * the exemplars imitated, the creative brief, the chosen sound, the asset URLs,
 * and the pre-publish virality score. `status` gates whether it queued or drafted.
 */
export const generatedVideos = sqliteTable(
  "generated_videos",
  {
    id: text("id").primaryKey(),
    topic: text("topic").notNull(),
    brief: text("brief", { mode: "json" }).$type<Record<string, unknown>>(),
    exemplars: text("exemplars", { mode: "json" }).$type<unknown[]>(),
    soundTrackUrl: text("sound_track_url"),
    soundMood: text("sound_mood"),
    coverImageUrl: text("cover_image_url"),
    /** Reel/video asset URL. Empty string for carousel-format records, which use slideUrls instead. */
    videoUrl: text("video_url").notNull(),
    /** Ordered slide image URLs for a qotd-carousel record (null for trend-video). */
    slideUrls: text("slide_urls", { mode: "json" }).$type<string[] | null>(),
    /** Which standardized content format produced this record. */
    format: text("format", { enum: ["trend-video", "qotd-carousel"] })
      .notNull()
      .default("trend-video"),
    viralityScore: integer("virality_score"),
    viralityReportUrl: text("virality_report_url"),
    status: text("status", {
      enum: ["generated", "scored", "queued", "draft", "publishing", "published", "rejected", "error"],
    }).notNull(),
    bufferPostId: text("buffer_post_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("generated_videos_topic_idx").on(t.topic)],
);

export type MusicTrack = typeof musicTracks.$inferSelect;
export type NewMusicTrack = typeof musicTracks.$inferInsert;
export type GeneratedVideo = typeof generatedVideos.$inferSelect;
export type NewGeneratedVideo = typeof generatedVideos.$inferInsert;

/**
 * A human-verified FRCR exam question, imported by the operator and rendered
 * verbatim into Question-of-the-Day carousels. The pipeline NEVER authors the
 * medical content here — it only formats/designs these records. `usedAt` drives
 * the subtopic rotation (least-recently-used wins).
 */
export const examQuestions = sqliteTable(
  "exam_questions",
  {
    id: text("id").primaryKey(),
    /** Content pillar / FRCR Physics subtopic, e.g. "ultrasound_physics". */
    subtopic: text("subtopic").notNull(),
    /** A single true/false statement (one row = one statement; carousels group several). */
    statement: text("statement").notNull(),
    /** Whether the statement is true. */
    correctAnswer: integer("correct_answer", { mode: "boolean" }).notNull(),
    /** Concise worked explanation shown on the reveal slide. */
    explanation: text("explanation").notNull(),
    /** Difficulty label (Easy/Medium/Hard), if provided by the source. */
    difficulty: text("difficulty"),
    /** Provenance (e.g. question_bank:<uuid>) for auditability. */
    source: text("source"),
    /** Last time this statement was posted; null = never used. */
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("exam_questions_subtopic_idx").on(t.subtopic, t.usedAt)],
);
export type ExamQuestion = typeof examQuestions.$inferSelect;
export type NewExamQuestion = typeof examQuestions.$inferInsert;

/**
 * Progress record for one web-triggered trend-imitation run. Written by the
 * in-process worker as the pipeline emits stage events, so the dashboard can
 * poll live A→B progress without holding an HTTP connection open.
 */
export const trendRuns = sqliteTable(
  "trend_runs",
  {
    id: text("id").primaryKey(),
    topic: text("topic").notNull(),
    mode: text("mode").notNull(),
    assetStyle: text("asset_style").notNull(),
    status: text("status", { enum: ["pending", "running", "ok", "failed", "awaiting_review"] })
      .notNull()
      .default("pending"),
    stages: text("stages", { mode: "json" }).$type<{ stage: string; data: unknown }[]>().notNull().default(sql`'[]'`),
    generatedVideoId: text("generated_video_id"),
    error: text("error"),
    /** opt-in pause-after-brief gate; when true the run stops at status="awaiting_review". */
    reviewEnabled: integer("review_enabled", { mode: "boolean" }).notNull().default(false),
    /** the render phase's JSON-serializable input (brief + resolved cover/video prompts), persisted while paused so an operator can edit it before resuming. */
    renderContext: text("render_context", { mode: "json" }).$type<Record<string, unknown> | null>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("trend_runs_created_idx").on(t.createdAt)],
);
export type TrendRun = typeof trendRuns.$inferSelect;
export type NewTrendRun = typeof trendRuns.$inferInsert;

/**
 * Operator overrides for the editable prompt templates in
 * `src/publishing/prompts.ts`. A missing row means "use the built-in
 * default" — this table only ever holds the diff.
 */
export const promptOverrides = sqliteTable("prompt_overrides", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export type PromptOverrideRow = typeof promptOverrides.$inferSelect;
export type NewPromptOverrideRow = typeof promptOverrides.$inferInsert;

/**
 * Library of selectable prompt variants per stage (the trend page's per-stage
 * dropdowns). `id` is the surrogate `${key}:${variantId}`; built-ins are seeded
 * from code once and flagged `builtin`. Fully CRUD-able from /settings/prompts.
 */
export const promptVariants = sqliteTable(
  "prompt_variants",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    variantId: text("variant_id").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull().default(""),
    template: text("template").notNull(),
    builtin: integer("builtin", { mode: "boolean" }).notNull().default(false),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("prompt_variants_key_idx").on(t.key)],
);
export type PromptVariantRow = typeof promptVariants.$inferSelect;
export type NewPromptVariantRow = typeof promptVariants.$inferInsert;

/**
 * Operator runtime state for the NotebookLM insight layer — the enable toggle,
 * mode, and selected notebook id, editable from /settings/notebooklm without
 * touching decode.config.yml. Single row keyed `id = "default"`. Cookies are
 * NEVER stored here — they live only in ~/.notebooklm/storage_state.json.
 */
export const notebooklmSettings = sqliteTable("notebooklm_settings", {
  id: text("id").primaryKey().default("default"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  mode: text("mode", { enum: ["discovery", "existing"] }).notNull().default("discovery"),
  notebookId: text("notebook_id").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});
export type NotebooklmSettingsRow = typeof notebooklmSettings.$inferSelect;
export type NewNotebooklmSettingsRow = typeof notebooklmSettings.$inferInsert;

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
export type LpsProperty = typeof lpsProperties.$inferSelect;
export type GeocodeCacheRow = typeof geocodeCache.$inferSelect;
export type ExtractionCacheRow = typeof extractionCache.$inferSelect;
export type Ranking = typeof rankings.$inferSelect;
export type PublishedPost = typeof publishedPosts.$inferSelect;
export type NewPublishedPost = typeof publishedPosts.$inferInsert;
export type SourceHealthRow = typeof sourceHealth.$inferSelect;
export type NewSourceHealthRow = typeof sourceHealth.$inferInsert;
export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;
export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
export type JobRunRow = typeof jobRuns.$inferSelect;
export type NewJobRunRow = typeof jobRuns.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
export type SeoSite = typeof seoSites.$inferSelect;
export type NewSeoSite = typeof seoSites.$inferInsert;
export type SeoAudit = typeof seoAudits.$inferSelect;
export type NewSeoAudit = typeof seoAudits.$inferInsert;
export type SeoPage = typeof seoPages.$inferSelect;
export type NewSeoPage = typeof seoPages.$inferInsert;
export type SeoTrend = typeof seoTrends.$inferSelect;
export type NewSeoTrend = typeof seoTrends.$inferInsert;
export type SeoRecommendation = typeof seoRecommendations.$inferSelect;
export type NewSeoRecommendation = typeof seoRecommendations.$inferInsert;
export type SeoRanking = typeof seoRankings.$inferSelect;
export type NewSeoRanking = typeof seoRankings.$inferInsert;
