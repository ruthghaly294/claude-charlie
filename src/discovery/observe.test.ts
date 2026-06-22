import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type DB } from "@/db/client";
import { signals, insights, events, type Signal } from "@/db/schema";
import { parseConfig, type DecodeConfig } from "./config";
import { runObserve } from "./observe";

function cfg(over: Partial<DecodeConfig> = {}): DecodeConfig {
  return { ...parseConfig({}), keywords: ["radiology", "frcr"], ...over };
}

function seed(db: DB, rows: Array<Partial<typeof signals.$inferInsert>>) {
  const now = new Date().toISOString();
  let i = 0;
  for (const r of rows) {
    i++;
    db.insert(signals)
      .values({
        id: `s${i}`,
        source: "rss",
        title: `title ${i}`,
        url: `https://x/${i}`,
        urlHash: `h${i}`,
        capturedAt: now,
        status: "new",
        ...r,
      })
      .run();
  }
}

describe("runObserve", () => {
  it("writes one insight per cluster and promotes observed signals to curated", async () => {
    const db = createDb(":memory:");
    seed(db, [
      { id: "a", cluster: "radiology", score: 0.8, status: "new" },
      { id: "b", cluster: "radiology", score: 0.9, status: "new" },
      { id: "c", cluster: "frcr", score: 0.5, status: "new" },
    ]);

    const sum = await runObserve(db, cfg());
    expect(sum.clustersObserved).toBe(2);
    expect(sum.insightsWritten).toBe(2);
    expect(sum.signalsObserved).toBe(3);

    const rows = db.select().from(insights).all();
    expect(rows).toHaveLength(2);
    const rad = rows.find((r) => r.cluster === "radiology");
    expect(rad?.evidence.sort()).toEqual(["a", "b"]);
    expect(rad?.importance).toBe("high"); // avg score 0.85 ≥ 0.7

    const promoted = db.select().from(signals).all();
    expect(promoted.every((s) => s.status === "curated")).toBe(true);
  });

  it("skips unclustered signals and clusters below minClusterSize", async () => {
    const db = createDb(":memory:");
    seed(db, [
      { id: "a", cluster: "unclustered", status: "new" },
      { id: "b", cluster: "radiology", status: "new" },
    ]);
    const sum = await runObserve(db, cfg({ minClusterSize: 2 }));
    expect(sum.clustersObserved).toBe(0);
    expect(db.select().from(insights).all()).toHaveLength(0);
    // unqualified signals stay 'new' so a later run can still pick them up
    expect(db.select().from(signals).all().every((s) => s.status === "new")).toBe(
      true,
    );
  });

  it("emits decode.insight_created with the cluster and trend for each insight written", async () => {
    const db = createDb(":memory:");
    seed(db, [
      { id: "a", cluster: "radiology", score: 0.8, status: "new" },
      { id: "b", cluster: "radiology", score: 0.9, status: "new" },
    ]);

    await runObserve(db, cfg());

    const rows = db.select().from(events).where(eq(events.type, "decode.insight_created")).all();
    expect(rows).toHaveLength(1);
    const payload = rows[0]?.payload as { insightId: string; cluster: string; trend: string };
    expect(payload.insightId).toBe("insight:radiology");
    expect(payload.cluster).toBe("radiology");
    expect(payload.trend).toContain("radiology");
  });

  it("is idempotent — a second run observes nothing and does not duplicate", async () => {
    const db = createDb(":memory:");
    seed(db, [
      { id: "a", cluster: "radiology", score: 0.8, status: "new" },
      { id: "b", cluster: "radiology", score: 0.9, status: "new" },
    ]);
    await runObserve(db, cfg());
    const second = await runObserve(db, cfg());
    expect(second.signalsObserved).toBe(0);
    expect(second.insightsWritten).toBe(0);
    expect(db.select().from(insights).all()).toHaveLength(1);
  });

  it("can be fed an alternate reasoner", async () => {
    const db = createDb(":memory:");
    seed(db, [{ id: "a", cluster: "radiology", score: 0.8, status: "new" }]);
    const sum = await runObserve(db, cfg(), {
      reasoner: {
        summarizeCluster: () => ({
          trend: "custom",
          body: "b",
          importance: "high",
        }),
        proposeDecision: () => ({
          title: "",
          effort: "low",
          confidence: "low",
          valuePerMonth: 0,
          rationale: "",
        }),
        draftAsset: () => ({ title: "", body: "" }),
      },
    });
    expect(sum.insightsWritten).toBe(1);
    expect(db.select().from(insights).get()?.trend).toBe("custom");
  });
});
