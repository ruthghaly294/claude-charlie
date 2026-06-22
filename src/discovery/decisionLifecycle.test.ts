import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type DB } from "@/db/client";
import { decisions, insights } from "@/db/schema";
import { parseConfig, type DecodeConfig } from "./config";
import { runDecisionLifecycle } from "./decisionLifecycle";

function cfg(over: Partial<DecodeConfig> = {}): DecodeConfig {
  return { ...parseConfig({}), ...over };
}

function seedDecision(db: DB, over: Partial<typeof decisions.$inferInsert> = {}) {
  db.insert(decisions)
    .values({
      id: "decision:insight:radiology",
      lane: "content",
      title: "Publish content on radiology",
      impact: "high",
      effort: "low",
      confidence: "high",
      value: 300,
      priority: 10,
      rationale: "because radiology is trending",
      fromInsights: ["insight:radiology"],
      status: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: null,
      expiresAt: null,
      ...over,
    })
    .run();
}

function seedInsight(db: DB, over: Partial<typeof insights.$inferInsert> = {}) {
  db.insert(insights)
    .values({
      id: "insight:radiology",
      cluster: "radiology",
      trend: "radiology trend",
      importance: "high",
      body: "",
      evidence: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      ...over,
    })
    .run();
}

describe("runDecisionLifecycle", () => {
  it("expires an open decision once its ttl (createdAt + ttl_days) has passed", async () => {
    const db = createDb(":memory:");
    seedDecision(db, { createdAt: "2026-01-01T00:00:00.000Z" });

    const sum = await runDecisionLifecycle(db, cfg({ decisions: { ttlDays: 14 } }), {
      now: () => "2026-01-16T00:00:00.000Z", // 15 days later
    });

    expect(sum).toEqual({ expired: 1, reopened: 0 });
    const row = db.select().from(decisions).get();
    expect(row?.status).toBe("expired");
    expect(row?.expiresAt).toBe("2026-01-15T00:00:00.000Z");
    expect(row?.updatedAt).toBe("2026-01-16T00:00:00.000Z");
  });

  it("leaves an open decision within its ttl alone but records expiresAt", async () => {
    const db = createDb(":memory:");
    seedDecision(db, { createdAt: "2026-01-01T00:00:00.000Z" });

    const sum = await runDecisionLifecycle(db, cfg({ decisions: { ttlDays: 14 } }), {
      now: () => "2026-01-10T00:00:00.000Z", // 9 days later, still within ttl
    });

    expect(sum).toEqual({ expired: 0, reopened: 0 });
    const row = db.select().from(decisions).get();
    expect(row?.status).toBe("open");
    expect(row?.expiresAt).toBe("2026-01-15T00:00:00.000Z");
  });

  it("reopens a done decision when its insight's cluster has newer activity, with an audit note", async () => {
    const db = createDb(":memory:");
    seedDecision(db, {
      status: "done",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    seedInsight(db, { createdAt: "2026-01-05T00:00:00.000Z" });

    const sum = await runDecisionLifecycle(db, cfg(), {
      now: () => "2026-01-10T00:00:00.000Z",
    });

    expect(sum).toEqual({ expired: 0, reopened: 1 });
    const row = db.select().from(decisions).get();
    expect(row?.status).toBe("reopened");
    expect(row?.updatedAt).toBe("2026-01-10T00:00:00.000Z");
    expect(row?.rationale).toContain("because radiology is trending");
    expect(row?.rationale).toContain("reopened");
    expect(row?.rationale).toContain("radiology");
  });

  it("does not reopen a done decision when its insight has no newer activity", async () => {
    const db = createDb(":memory:");
    seedDecision(db, {
      status: "done",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    seedInsight(db, { createdAt: "2026-01-01T00:00:00.000Z" });

    const sum = await runDecisionLifecycle(db, cfg(), {
      now: () => "2026-01-10T00:00:00.000Z",
    });

    expect(sum).toEqual({ expired: 0, reopened: 0 });
    const row = db.select().from(decisions).get();
    expect(row?.status).toBe("done");
  });

  it("reopens an expired decision when its insight's cluster has newer activity", async () => {
    const db = createDb(":memory:");
    seedDecision(db, {
      status: "expired",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-15T00:00:00.000Z",
      expiresAt: "2026-01-15T00:00:00.000Z",
    });
    seedInsight(db, { createdAt: "2026-01-20T00:00:00.000Z" });

    const sum = await runDecisionLifecycle(db, cfg(), {
      now: () => "2026-01-25T00:00:00.000Z",
    });

    expect(sum).toEqual({ expired: 0, reopened: 1 });
    const row = db.select().from(decisions).where(eq(decisions.id, "decision:insight:radiology")).get();
    expect(row?.status).toBe("reopened");
  });
});
