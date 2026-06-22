import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { entities } from "@/db/schema";

/** Deterministic query-expansion templates; `{kw}` is replaced with the keyword. */
export const DEFAULT_EXPANSION_TEMPLATES = [
  "{kw}",
  "{kw} tutorial",
  "{kw} 2026",
  "best {kw} tools",
];

/** The kinds of research entities the entities table can hold. */
export const entityKindSchema = z.enum([
  "subreddit",
  "github_topic",
  "youtube_query",
  "author",
  "hashtag",
  "feed",
]);
export type EntityKind = z.infer<typeof entityKindSchema>;

/** A research entity to seed as active/source="seed" if not already present. */
export type SeedEntity = {
  keyword: string;
  kind: EntityKind;
  value: string;
  weight?: number;
};

/** Relative contribution of each component to a research item's composite score (src/research/rank.ts). */
export type RankWeights = {
  relevance: number;
  engagement: number;
  recency: number;
};

export type ResearchConfig = {
  expansionTemplates: string[];
  maxQueriesPerConnector: number;
  perAuthorCap: number;
  /** Composite-score weights for src/research/rank.ts's rankReport. */
  rankWeights: RankWeights;
  /** Recency decay half-life (days) for rankReport. */
  halfLifeDays: number;
  /** How many top-scoring items rankReport surfaces as topPicks. */
  topN: number;
  /** blend embedding-based semantic similarity into relevance (needs an embedding key). */
  semanticRerank: boolean;
  /** scrape the page bodies behind top picks and distill a grounded insight (NotebookLM-free). */
  webResearch: boolean;
};

export const DEFAULT_RANK_WEIGHTS: RankWeights = {
  relevance: 0.4,
  engagement: 0.35,
  recency: 0.25,
};

export const DEFAULT_RESEARCH_CONFIG: ResearchConfig = {
  expansionTemplates: DEFAULT_EXPANSION_TEMPLATES,
  maxQueriesPerConnector: 4,
  perAuthorCap: 3,
  rankWeights: DEFAULT_RANK_WEIGHTS,
  halfLifeDays: 7,
  topN: 8,
  semanticRerank: false,
  webResearch: false,
};

/** Search-style connectors that consume a flat list of query strings. */
const SEARCH_CONNECTORS = ["youtube", "hackernews", "google_cse"] as const;

export type ResearchPlan = {
  /** expanded search queries per connector key, deduped + capped */
  queries: Record<string, string[]>;
  /** active "subreddit" entity values, for the reddit connector */
  subreddits: string[];
  /** active "github_topic" entity values, for the github_trending connector */
  githubTopics: string[];
};

/** Expand each keyword through `templates`, dedup, then cap to `cap` total. */
function expandKeywords(keywords: string[], templates: string[], cap: number): string[] {
  const out: string[] = [];
  for (const kw of keywords) {
    for (const tpl of templates) {
      const q = tpl.replace("{kw}", kw);
      if (!out.includes(q)) out.push(q);
    }
  }
  return out.slice(0, cap);
}

function dedupCap(values: string[], cap: number): string[] {
  return [...new Set(values)].slice(0, cap);
}

/**
 * Resolve keywords + active entities into per-connector query plans:
 * deterministic template expansion for search connectors (youtube,
 * hackernews, google_cse), plus resolved subreddits / GitHub topics from the
 * entities table. Additive — connectors that ignore `ctx.queries` behave
 * exactly as before.
 */
export function buildResearchPlan(
  config: { keywords: string[]; research?: Partial<ResearchConfig> },
  db: DB,
): ResearchPlan {
  const research = { ...DEFAULT_RESEARCH_CONFIG, ...config.research };
  const expanded = expandKeywords(
    config.keywords,
    research.expansionTemplates,
    research.maxQueriesPerConnector,
  );

  const queries: Record<string, string[]> = {};
  for (const key of SEARCH_CONNECTORS) queries[key] = expanded;

  const active = db.select().from(entities).where(eq(entities.status, "active")).all();

  // entity-resolved queries are more targeted than generic template
  // expansions, so they take priority within the per-connector cap.
  const youtubeExtra = active.filter((e) => e.kind === "youtube_query").map((e) => e.value);
  queries.youtube = dedupCap(
    [...youtubeExtra, ...queries.youtube!],
    research.maxQueriesPerConnector,
  );

  const subreddits = active.filter((e) => e.kind === "subreddit").map((e) => e.value);
  const githubTopics = active.filter((e) => e.kind === "github_topic").map((e) => e.value);

  return { queries, subreddits, githubTopics };
}

/**
 * Insert each seed as an active/source="seed" entity, unless an entity with
 * the same kind+value already exists (any status) — re-runs stay idempotent.
 */
export function seedEntities(
  db: DB,
  seeds: SeedEntity[],
  now: () => string = () => new Date().toISOString(),
): { inserted: number } {
  if (seeds.length === 0) return { inserted: 0 };

  const existing = db.select().from(entities).all();
  const seen = new Set(existing.map((e) => `${e.kind}:${e.value}`));

  const rows: (typeof entities.$inferInsert)[] = [];
  for (const s of seeds) {
    const key = `${s.kind}:${s.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: randomUUID(),
      keyword: s.keyword,
      kind: s.kind,
      value: s.value,
      weight: s.weight ?? 1,
      status: "active",
      source: "seed",
      createdAt: now(),
    });
  }

  if (rows.length > 0) db.insert(entities).values(rows).run();
  return { inserted: rows.length };
}
