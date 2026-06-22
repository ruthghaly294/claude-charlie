import { describe, it, expect } from "vitest";
import { createDb } from "@/db/client";
import { decisions, decodeRuns, executions } from "@/db/schema";
import { getCommandCenter } from "./commandCenter";

describe("getCommandCenter", () => {
  it("ranks open decisions by priority with effort-hours and value", () => {
    const db = createDb(":memory:");
    const now = new Date().toISOString();
    db.insert(decisions)
      .values([
        {
          id: "d1",
          lane: "content",
          title: "high prio",
          impact: "high",
          effort: "low",
          confidence: "high",
          value: 1200,
          priority: 90,
          status: "open",
          createdAt: now,
        },
        {
          id: "d2",
          lane: "product",
          title: "low prio",
          impact: "low",
          effort: "high",
          confidence: "low",
          value: 0,
          priority: 5,
          status: "open",
          createdAt: now,
        },
        {
          id: "d3",
          lane: "content",
          title: "done one",
          impact: "high",
          effort: "low",
          confidence: "high",
          value: 999,
          priority: 88,
          status: "done",
          createdAt: now,
        },
      ])
      .run();

    const cc = getCommandCenter(db, { DECODE_BUDGET_USD: "10" });
    // ranked by priority across all decisions; "done" surfaces as "drafted"
    expect(cc.focusToday[0]?.title).toBe("high prio");
    expect(cc.focusToday.find((a) => a.title === "done one")?.status).toBe(
      "drafted",
    );
    expect(cc.focusToday[0]?.effortHours).toBeGreaterThan(0);
    expect(cc.counts.decisions).toBe(3);
  });

  it("counts only ready, content-lane executions toward contentQueue", () => {
    const db = createDb(":memory:");
    const now = new Date().toISOString();
    db.insert(executions)
      .values([
        { id: "exec:ready-content", lane: "content", title: "a", body: "", status: "ready", createdAt: now },
        { id: "exec:ready-product", lane: "product", title: "b", body: "", status: "ready", createdAt: now },
        { id: "exec:draft-content", lane: "content", title: "c", body: "", status: "draft", createdAt: now },
      ])
      .run();

    const cc = getCommandCenter(db, { DECODE_BUDGET_USD: "10" });
    expect(cc.counts.contentQueue).toBe(1);
    expect(cc.counts.executions).toBe(3);
  });

  it("reports spend vs budget and the latest run", () => {
    const db = createDb(":memory:");
    const now = new Date().toISOString();
    db.insert(decodeRuns)
      .values({
        id: "r1",
        startedAt: now,
        finishedAt: now,
        status: "ok",
        stages: [{ stage: "observe", durationMs: 10, count: 2 }],
        costUsd: 2,
        tokensIn: 1000,
        tokensOut: 500,
      })
      .run();

    const cc = getCommandCenter(db, { DECODE_BUDGET_USD: "10" });
    expect(cc.spend.costUsd).toBe(2);
    expect(cc.spend.budgetUsd).toBe(10);
    expect(cc.spend.pct).toBe(20);
    expect(cc.lastRun?.status).toBe("ok");
    expect(cc.lastRun?.stages[0]?.stage).toBe("observe");
  });
});
