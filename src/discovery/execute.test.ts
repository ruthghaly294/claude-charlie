import { describe, it, expect } from "vitest";
import { createDb, type DB } from "@/db/client";
import { decisions, executions } from "@/db/schema";
import { parseConfig, type DecodeConfig } from "./config";
import { runExecute } from "./execute";

function cfg(over: Partial<DecodeConfig> = {}): DecodeConfig {
  return { ...parseConfig({}), ...over };
}

function seedDecision(
  db: DB,
  over: Partial<typeof decisions.$inferInsert> = {},
) {
  db.insert(decisions)
    .values({
      id: "decision:1",
      lane: "content",
      title: "Publish content on radiology",
      impact: "high",
      effort: "low",
      priority: 10,
      rationale: "because",
      fromInsights: ["insight:radiology"],
      status: "open",
      createdAt: new Date().toISOString(),
      ...over,
    })
    .run();
}

describe("runExecute", () => {
  it("drafts the top-N decisions by priority and marks them done", async () => {
    const db = createDb(":memory:");
    seedDecision(db, { id: "decision:1", priority: 10, title: "high" });
    seedDecision(db, { id: "decision:2", priority: 5, title: "mid" });
    seedDecision(db, { id: "decision:3", priority: 1, title: "low" });

    const sum = await runExecute(db, cfg({ topN: 2 }));
    expect(sum.executionsWritten).toBe(2);

    const drafts = db.select().from(executions).all();
    expect(drafts).toHaveLength(2);
    // neutral critic scores 4 ≥ default threshold 3.5 → ready
    expect(drafts.every((e) => e.status === "ready")).toBe(true);
    expect(drafts.every((e) => e.qualityScore === 4)).toBe(true);
    expect(sum.readyCount).toBe(2);
    expect(drafts.map((e) => e.title).sort()).toEqual(["high", "mid"]);

    const done = db
      .select()
      .from(decisions)
      .all()
      .filter((d) => d.status === "done");
    expect(done.map((d) => d.id).sort()).toEqual(["decision:1", "decision:2"]);
    // the unselected low-priority decision stays open
    const low = db
      .select()
      .from(decisions)
      .all()
      .find((d) => d.id === "decision:3");
    expect(low?.status).toBe("open");
  });

  it("keeps drafts below the quality threshold as 'draft'", async () => {
    const db = createDb(":memory:");
    seedDecision(db, { id: "decision:1" });
    const sum = await runExecute(db, cfg({ qualityThreshold: 5 }));
    expect(sum.readyCount).toBe(0);
    expect(db.select().from(executions).get()?.status).toBe("draft");
  });

  it("links each execution back to its decision and lane", async () => {
    const db = createDb(":memory:");
    seedDecision(db, { id: "decision:1", lane: "product" });
    await runExecute(db, cfg());
    const e = db.select().from(executions).get();
    expect(e?.decisionId).toBe("decision:1");
    expect(e?.lane).toBe("product");
    expect(e?.body.toLowerCase()).toContain("user stories");
  });

  it("is idempotent — a second run finds no open decisions", async () => {
    const db = createDb(":memory:");
    seedDecision(db);
    await runExecute(db, cfg());
    const second = await runExecute(db, cfg());
    expect(second.executionsWritten).toBe(0);
    expect(db.select().from(executions).all()).toHaveLength(1);
  });
});
