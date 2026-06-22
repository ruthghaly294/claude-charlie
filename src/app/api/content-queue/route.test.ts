import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any */
let GET: () => Promise<Response>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "content-queue-api-"));
  process.env.DECODE_DB_PATH = join(dir, "t.db");

  const { getDb } = await import("@/db/client");
  const { executions } = await import("@/db/schema");
  const db = getDb();
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
    ])
    .run();

  GET = (await import("./route")).GET as any;
});

describe("GET /api/content-queue", () => {
  it("returns only ready, content-lane executions", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.map((r: any) => r.id)).toEqual(["exec:ready-content"]);
  });
});
