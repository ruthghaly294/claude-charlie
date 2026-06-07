import { describe, it, expect } from "vitest";
import { createDb, type DB } from "@/db/client";
import { insights, decisions } from "@/db/schema";
import { parseConfig, type DecodeConfig } from "./config";
import { runDecide, computePriority } from "./decide";

function cfg(over: Partial<DecodeConfig> = {}): DecodeConfig {
  return { ...parseConfig({}), ...over };
}

function seedInsight(db: DB, over: Partial<typeof insights.$inferInsert> = {}) {
  db.insert(insights)
    .values({
      id: "insight:radiology",
      cluster: "radiology",
      trend: "radiology trend",
      importance: "high",
      body: "",
      evidence: ["a", "b"],
      createdAt: new Date().toISOString(),
      ...over,
    })
    .run();
}

describe("computePriority", () => {
  it("scores high-impact / low-effort at the top of the 1–10 range", () => {
    expect(computePriority("high", "low")).toBe(10);
  });
  it("scores high-impact / high-effort lower", () => {
    expect(computePriority("high", "high")).toBeLessThan(
      computePriority("high", "low"),
    );
  });
});

describe("runDecide", () => {
  it("writes one decision per insight with priority and provenance", async () => {
    const db = createDb(":memory:");
    seedInsight(db);
    const sum = await runDecide(db, cfg());
    expect(sum.decisionsWritten).toBe(1);

    const d = db.select().from(decisions).get();
    expect(d?.impact).toBe("high");
    expect(d?.fromInsights).toEqual(["insight:radiology"]);
    expect(d?.priority).toBeGreaterThan(0);
    expect(d?.title.toLowerCase()).toContain("radiology");
  });

  it("respects an explicit cluster→lane override", async () => {
    const db = createDb(":memory:");
    seedInsight(db);
    await runDecide(db, cfg({ clusterLanes: { radiology: "product" } }));
    expect(db.select().from(decisions).get()?.lane).toBe("product");
  });

  it("round-robins lanes across insights when no override is set", async () => {
    const db = createDb(":memory:");
    seedInsight(db, { id: "insight:a", cluster: "a" });
    seedInsight(db, { id: "insight:b", cluster: "b" });
    await runDecide(db, cfg());
    const lanes = db
      .select()
      .from(decisions)
      .all()
      .map((d) => d.lane);
    expect(new Set(lanes).size).toBe(2);
  });

  it("is idempotent — re-running updates rather than duplicating", async () => {
    const db = createDb(":memory:");
    seedInsight(db);
    await runDecide(db, cfg());
    await runDecide(db, cfg());
    expect(db.select().from(decisions).all()).toHaveLength(1);
  });
});
