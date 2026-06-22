import { describe, it, expect } from "vitest";
import { createDb } from "@/db/client";
import { signals, rankings } from "@/db/schema";
import { parseConfig, type DecodeConfig } from "./config";
import { runFeedback, loadMultipliersFromDb } from "./feedback";
import { runCurate } from "./curate";

function cfg(over: Partial<DecodeConfig> = {}): DecodeConfig {
  return {
    ...parseConfig({}),
    keywords: ["radiology", "frcr"],
    keepThreshold: 0.4,
    ...over,
  };
}

function seed(
  db: ReturnType<typeof createDb>,
  rows: Array<Partial<typeof signals.$inferInsert>>,
) {
  const now = new Date().toISOString();
  let i = 0;
  for (const r of rows) {
    i++;
    db.insert(signals)
      .values({
        id: `s${i}`,
        source: "rss",
        title: "t",
        url: `https://x/${i}`,
        urlHash: `h${i}`,
        capturedAt: now,
        ...r,
      })
      .run();
  }
}

describe("runFeedback", () => {
  it("normalises metrics to [0.5,1.5] multipliers and upserts", () => {
    const db = createDb(":memory:");
    const out = runFeedback(db, [
      { keyword: "frcr", value: 100 },
      { keyword: "radiology", value: 20 },
      { keyword: "viva", value: 60 },
    ]);
    const byKw = Object.fromEntries(out.map((r) => [r.keyword, r.multiplier]));
    expect(byKw.frcr).toBe(1.5);
    expect(byKw.radiology).toBe(0.5);
    expect(byKw.viva).toBeGreaterThan(0.5);
    expect(byKw.viva).toBeLessThan(1.5);
    expect(db.select().from(rankings).all()).toHaveLength(3);
  });

  it("upsert updates an existing keyword rather than duplicating", () => {
    const db = createDb(":memory:");
    runFeedback(db, [
      { keyword: "frcr", value: 1 },
      { keyword: "x", value: 2 },
    ]);
    runFeedback(db, [
      { keyword: "frcr", value: 5 },
      { keyword: "x", value: 1 },
    ]);
    expect(db.select().from(rankings).all()).toHaveLength(2);
    expect(loadMultipliersFromDb(db).frcr).toBe(1.5);
  });

  it("ignores empty/non-numeric rows", () => {
    const db = createDb(":memory:");
    expect(runFeedback(db, [{ keyword: "", value: 1 }])).toEqual([]);
  });
});

describe("runCurate", () => {
  it("keeps relevant signals and archives irrelevant ones", () => {
    const db = createDb(":memory:");
    seed(db, [
      { id: "a", title: "Radiology FRCR", raw: "", status: "new" },
      { id: "b", title: "Cooking pasta", raw: "", status: "new" },
    ]);
    const sum = runCurate(db, cfg());
    expect(sum.processed).toBe(2);
    const a = db
      .select()
      .from(signals)
      .all()
      .find((s) => s.id === "a");
    const b = db
      .select()
      .from(signals)
      .all()
      .find((s) => s.id === "b");
    expect(a?.status).toBe("new");
    expect(a?.score).toBe(1);
    expect(b?.status).toBe("archived");
    expect(b?.score).toBe(0);
  });

  it("applies feedback multipliers on the next curate", () => {
    const db = createDb(":memory:");
    seed(db, [{ id: "c", title: "FRCR tips", raw: "", status: "new" }]);
    runFeedback(db, [
      { keyword: "frcr", value: 10 },
      { keyword: "radiology", value: 0 },
    ]);
    runCurate(db, cfg());
    // frcr boosted ×1.5, only frcr matches of 2 keywords → 1.5/2 = 0.75
    expect(db.select().from(signals).get()?.score).toBe(0.75);
  });

  it("can revive an archived signal when feedback raises its score", () => {
    const db = createDb(":memory:");
    seed(db, [
      { id: "d", title: "frcr", raw: "", status: "archived", score: 0.5 },
    ]);
    runFeedback(db, [
      { keyword: "frcr", value: 10 },
      { keyword: "radiology", value: 0 },
    ]);
    runCurate(db, cfg({ keepThreshold: 0.7 }));
    expect(db.select().from(signals).get()?.status).toBe("new"); // 0.75 ≥ 0.7
  });
});
