import { describe, it, expect } from "vitest";
import { createDb, type DB } from "@/db/client";
import { signals, decisions, decodeRuns } from "@/db/schema";
import { parseConfig, type DecodeConfig } from "./config";
import { runDecode } from "./runDecode";

function cfg(over: Partial<DecodeConfig> = {}): DecodeConfig {
  return {
    ...parseConfig({}),
    keywords: ["radiology", "frcr"],
    keepThreshold: 0.4,
    ...over,
  };
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
        title: "t",
        url: `https://x/${i}`,
        urlHash: `h${i}`,
        capturedAt: now,
        status: "new",
        ...r,
      })
      .run();
  }
}

describe("runDecode", () => {
  it("runs curate→observe→decide→execute and returns a 4-panel digest", async () => {
    const db = createDb(":memory:");
    seed(db, [
      { id: "a", title: "Radiology FRCR advances", raw: "" },
      { id: "b", title: "Radiology imaging update", raw: "" },
      { id: "c", title: "Cooking pasta tonight", raw: "" },
    ]);

    const digest = await runDecode(db, cfg());

    expect(digest.signals.kept).toBe(2);
    expect(digest.signals.archived).toBe(1);
    expect(digest.insights.count).toBe(1);
    expect(digest.insights.top[0]?.trend).toContain("radiology");
    expect(digest.decisions.count).toBe(1);
    expect(digest.executions.count).toBe(1);
    expect(digest.executions.top[0]?.title.toLowerCase()).toContain("radiology");
  });

  it("applies feedback metrics before curating when provided", async () => {
    const db = createDb(":memory:");
    seed(db, [{ id: "a", title: "FRCR tips", raw: "" }]);
    const digest = await runDecode(db, cfg(), {
      metrics: [
        { keyword: "frcr", value: 10 },
        { keyword: "radiology", value: 0 },
      ],
    });
    // frcr boosted ×1.5, 1 of 2 keywords match → score 0.75, kept
    expect(digest.signals.kept).toBe(1);
    expect(db.select().from(signals).get()?.score).toBe(0.75);
  });

  it("clusters by source for broad, keyword-light runs", async () => {
    const db = createDb(":memory:");
    seed(db, [
      { id: "a", source: "reddit", title: "anything at all", raw: "" },
      { id: "b", source: "github_trending", title: "some repo", raw: "" },
    ]);
    const digest = await runDecode(db, cfg({ keywords: [] }));
    expect(digest.signals.kept).toBe(2);
    expect(digest.insights.count).toBe(2);
    const clusters = db
      .select()
      .from(signals)
      .all()
      .map((s) => s.cluster)
      .sort();
    expect(clusters).toEqual(["github_trending", "reddit"]);
  });

  it("records a decode_runs row with stage telemetry", async () => {
    const db = createDb(":memory:");
    seed(db, [
      { id: "a", title: "Radiology FRCR", raw: "" },
      { id: "b", title: "Radiology imaging", raw: "" },
    ]);
    await runDecode(db, cfg());
    const run = db.select().from(decodeRuns).get();
    expect(run?.status).toBe("ok");
    expect(run?.finishedAt).toBeTruthy();
    expect(run?.stages.map((s) => s.stage)).toEqual([
      "curate",
      "observe",
      "decide",
      "execute",
      "package",
    ]);
    expect(run?.costUsd).toBe(0); // deterministic reasoner = no spend
  });

  it("is idempotent end-to-end", async () => {
    const db = createDb(":memory:");
    seed(db, [
      { id: "a", title: "Radiology FRCR", raw: "" },
      { id: "b", title: "Radiology imaging", raw: "" },
    ]);
    await runDecode(db, cfg());
    const second = await runDecode(db, cfg());
    expect(second.insights.count).toBe(1);
    expect(db.select().from(decisions).all()).toHaveLength(1);
  });
});
