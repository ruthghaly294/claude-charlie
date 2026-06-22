import { describe, it, expect } from "vitest";
import { createDb, type DB } from "@/db/client";
import {
  signals,
  insights,
  decisions,
  executions,
  products,
  decodeRuns,
} from "@/db/schema";
import { parseConfig } from "@/discovery/config";
import { runDecode } from "@/discovery/runDecode";

/**
 * Golden eval: a full deterministic run must always honour the "premium,
 * monetizable, decision-grade" contract. This is the regression guard for
 * output quality — if a change breaks the monetization framing or the loop's
 * shape, this fails. Hermetic (deterministic reasoner/critic), CI-safe.
 */
function seedGolden(db: DB) {
  const now = new Date().toISOString();
  const rows = [
    "New 13F filings show concentrated institutional buying",
    "13F data: hedge funds rotate into AI",
    "Best web scraping framework for 2026",
    "Scaling a web scraping pipeline without bans",
    "A cooking recipe for pasta", // noise → archived
  ];
  rows.forEach((title, i) =>
    db
      .insert(signals)
      .values({
        id: `g${i}`,
        source: "rss",
        title,
        url: `https://x/${i}`,
        urlHash: `h${i}`,
        capturedAt: now,
        status: "new",
      })
      .run(),
  );
}

describe("golden eval — monetization contract", () => {
  it("produces ranked, monetizable, sellable output end-to-end", async () => {
    const db = createDb(":memory:");
    seedGolden(db);
    const config = parseConfig({
      business: { keywords: ["13f", "web scraping"] },
      scoring: { keep_threshold: 0.3 },
      monetization: ["newsletter", "download", "thread"],
    });

    const digest = await runDecode(db, config);

    // Insights: present and framed for monetization
    const insightRows = db.select().from(insights).all();
    expect(insightRows.length).toBeGreaterThanOrEqual(1);
    expect(
      insightRows.every((i) => i.body.includes("Monetizable angle:")),
    ).toBe(true);

    // Decisions: ranked with a monetization plan
    const decisionRows = db.select().from(decisions).all();
    expect(decisionRows.length).toBeGreaterThanOrEqual(1);
    expect(decisionRows.every((d) => d.priority > 0)).toBe(true);
    expect(decisionRows.every((d) => d.rationale.includes("Monetization:"))).toBe(
      true,
    );

    // Executions: vetted by the quality gate
    const execRows = db.select().from(executions).all();
    expect(execRows.length).toBeGreaterThanOrEqual(1);
    expect(execRows.every((e) => e.qualityScore > 0)).toBe(true);
    expect(execRows.some((e) => e.status === "ready")).toBe(true);

    // Products: one per ready execution per configured format, non-empty
    const productRows = db.select().from(products).all();
    const readyCount = execRows.filter((e) => e.status === "ready").length;
    expect(productRows.length).toBe(readyCount * 3);
    expect(productRows.every((p) => p.body.length > 0)).toBe(true);

    // Run telemetry recorded
    const run = db.select().from(decodeRuns).get();
    expect(run?.status).toBe("ok");
    expect(run?.stages).toHaveLength(5);

    // Digest matches reality
    expect(digest.decisions.count).toBe(decisionRows.length);
    expect(digest.signals.archived).toBe(1); // the pasta recipe
  });
});
