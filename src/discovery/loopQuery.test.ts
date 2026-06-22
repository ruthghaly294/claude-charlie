import { describe, it, expect } from "vitest";
import { createDb } from "@/db/client";
import { executions } from "@/db/schema";
import { queryContentQueue, countContentQueue } from "./loopQuery";

function seed(db: ReturnType<typeof createDb>) {
  const now = new Date().toISOString();
  db.insert(executions)
    .values([
      {
        id: "exec:ready-content",
        lane: "content",
        title: "Ready content",
        body: "body",
        status: "ready",
        createdAt: now,
      },
      {
        id: "exec:draft-content",
        lane: "content",
        title: "Draft content",
        body: "body",
        status: "draft",
        createdAt: now,
      },
      {
        id: "exec:ready-product",
        lane: "product",
        title: "Ready product",
        body: "body",
        status: "ready",
        createdAt: now,
      },
      {
        id: "exec:published-content",
        lane: "content",
        title: "Published content",
        body: "body",
        status: "published",
        createdAt: now,
      },
    ])
    .run();
}

describe("queryContentQueue", () => {
  it("returns only ready, content-lane executions", () => {
    const db = createDb(":memory:");
    seed(db);
    const rows = queryContentQueue(db);
    expect(rows.map((r) => r.id)).toEqual(["exec:ready-content"]);
  });
});

describe("countContentQueue", () => {
  it("counts only ready, content-lane executions", () => {
    const db = createDb(":memory:");
    seed(db);
    expect(countContentQueue(db)).toBe(1);
  });

  it("is 0 when there's nothing to review", () => {
    const db = createDb(":memory:");
    expect(countContentQueue(db)).toBe(0);
  });
});
