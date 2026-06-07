import { describe, it, expect } from "vitest";
import { createDb, type DB } from "@/db/client";
import { executions, products } from "@/db/schema";
import { parseConfig, type DecodeConfig } from "./config";
import { runPackage, formatProduct, toThread } from "./package";

function cfg(over: Partial<DecodeConfig> = {}): DecodeConfig {
  return { ...parseConfig({}), ...over };
}

function seedExec(db: DB, over: Partial<typeof executions.$inferInsert> = {}) {
  db.insert(executions)
    .values({
      id: "exec:1",
      decisionId: "decision:1",
      lane: "content",
      title: "The Smart-Money Tracker",
      body: "Congress is buying. Here is what changed. Mirror the flow. Profit.",
      status: "ready",
      qualityScore: 4,
      createdAt: new Date().toISOString(),
      ...over,
    })
    .run();
}

describe("toThread", () => {
  it("produces numbered tweet chunks starting with a hook", () => {
    const t = toThread("Hook", "One. Two. Three.");
    expect(t.startsWith("1/ Hook")).toBe(true);
    expect(t).toContain("2/");
  });
});

describe("formatProduct", () => {
  it("prices a download by lane and includes a listing", () => {
    const exec = { title: "T", body: "b", lane: "product" } as never;
    const p = formatProduct("download", exec);
    expect(p.price).toBe(29);
    expect(p.body).toContain("Listing");
  });
});

describe("runPackage", () => {
  it("creates one product per ready execution per configured format", () => {
    const db = createDb(":memory:");
    seedExec(db);
    const sum = runPackage(db, cfg({ monetization: ["newsletter", "thread"] }));
    expect(sum.productsWritten).toBe(2);
    const rows = db.select().from(products).all();
    expect(rows.map((r) => r.format).sort()).toEqual(["newsletter", "thread"]);
  });

  it("ignores executions that are not ready", () => {
    const db = createDb(":memory:");
    seedExec(db, { status: "draft" });
    expect(runPackage(db, cfg()).productsWritten).toBe(0);
  });

  it("is idempotent — re-running updates rather than duplicating", () => {
    const db = createDb(":memory:");
    seedExec(db);
    runPackage(db, cfg({ monetization: ["file"] }));
    runPackage(db, cfg({ monetization: ["file"] }));
    expect(db.select().from(products).all()).toHaveLength(1);
  });
});
