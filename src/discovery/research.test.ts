import { describe, it, expect } from "vitest";
import { createDb } from "@/db/client";
import { entities } from "@/db/schema";
import { buildResearchPlan, seedEntities, DEFAULT_RESEARCH_CONFIG } from "./research";

function seedEntity(
  db: ReturnType<typeof createDb>,
  over: Partial<typeof entities.$inferInsert> = {},
): void {
  db.insert(entities)
    .values({
      id: over.id ?? "e1",
      keyword: over.keyword ?? "web scraping",
      kind: over.kind ?? "subreddit",
      value: over.value ?? "webscraping",
      weight: over.weight ?? 1,
      status: over.status ?? "active",
      source: over.source ?? "seed",
      createdAt: new Date().toISOString(),
      ...over,
    })
    .run();
}

describe("buildResearchPlan", () => {
  it("expands each search-connector's queries from keywords using the default templates", () => {
    const db = createDb(":memory:");
    const plan = buildResearchPlan({ keywords: ["web scraping"] }, db);
    expect(plan.queries.youtube).toEqual([
      "web scraping",
      "web scraping tutorial",
      "web scraping 2026",
      "best web scraping tools",
    ]);
    expect(plan.queries.hackernews).toEqual(plan.queries.youtube);
    expect(plan.queries.google_cse).toEqual(plan.queries.youtube);
    expect(plan.subreddits).toEqual([]);
    expect(plan.githubTopics).toEqual([]);
  });

  it("caps total expanded queries per connector at maxQueriesPerConnector", () => {
    const db = createDb(":memory:");
    const plan = buildResearchPlan({ keywords: ["web scraping", "saas marketing"] }, db);
    expect(plan.queries.youtube).toHaveLength(DEFAULT_RESEARCH_CONFIG.maxQueriesPerConnector);
    // first keyword's expansions fill the cap before the second keyword is considered
    expect(plan.queries.youtube).toEqual([
      "web scraping",
      "web scraping tutorial",
      "web scraping 2026",
      "best web scraping tools",
    ]);
  });

  it("resolves active subreddit/github_topic entities into their connector lists", () => {
    const db = createDb(":memory:");
    seedEntity(db, { id: "e1", kind: "subreddit", value: "algotrading" });
    seedEntity(db, { id: "e2", kind: "github_topic", value: "llm-agents" });
    seedEntity(db, { id: "e3", kind: "subreddit", value: "rejected-sub", status: "rejected" });
    const plan = buildResearchPlan({ keywords: [] }, db);
    expect(plan.subreddits).toEqual(["algotrading"]);
    expect(plan.githubTopics).toEqual(["llm-agents"]);
  });

  it("appends active youtube_query entities to the youtube query list, deduped and capped", () => {
    const db = createDb(":memory:");
    seedEntity(db, { id: "e1", kind: "youtube_query", value: "extra query" });
    const plan = buildResearchPlan({ keywords: ["web scraping"] }, db);
    expect(plan.queries.youtube).toContain("extra query");
    expect(plan.queries.youtube!.length).toBeLessThanOrEqual(
      DEFAULT_RESEARCH_CONFIG.maxQueriesPerConnector,
    );
  });

  it("excludes proposed/rejected entities from every list", () => {
    const db = createDb(":memory:");
    seedEntity(db, { id: "e1", kind: "subreddit", value: "proposed-sub", status: "proposed" });
    const plan = buildResearchPlan({ keywords: [] }, db);
    expect(plan.subreddits).toEqual([]);
  });

  it("honors a custom research config (templates + cap)", () => {
    const db = createDb(":memory:");
    const plan = buildResearchPlan(
      {
        keywords: ["radiology"],
        research: { expansionTemplates: ["{kw}", "{kw} cases"], maxQueriesPerConnector: 1 },
      },
      db,
    );
    expect(plan.queries.youtube).toEqual(["radiology"]);
  });
});

describe("seedEntities", () => {
  it("is a no-op with an empty seed list", () => {
    const db = createDb(":memory:");
    const result = seedEntities(db, []);
    expect(result).toEqual({ inserted: 0 });
    expect(db.select().from(entities).all()).toEqual([]);
  });

  it("inserts seeds as active/seed entities with a default weight of 1", () => {
    const db = createDb(":memory:");
    const result = seedEntities(db, [
      { keyword: "web scraping", kind: "subreddit", value: "scrapy" },
    ]);
    expect(result).toEqual({ inserted: 1 });
    const row = db.select().from(entities).get();
    expect(row).toMatchObject({
      keyword: "web scraping",
      kind: "subreddit",
      value: "scrapy",
      weight: 1,
      status: "active",
      source: "seed",
    });
  });

  it("skips seeds that already exist by kind+value, regardless of status", () => {
    const db = createDb(":memory:");
    seedEntity(db, { id: "e1", kind: "subreddit", value: "scrapy", status: "rejected" });
    const result = seedEntities(db, [
      { keyword: "web scraping", kind: "subreddit", value: "scrapy" },
    ]);
    expect(result).toEqual({ inserted: 0 });
    const rows = db.select().from(entities).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("rejected");
  });
});
