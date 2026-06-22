import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any */
let POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "executions-id-api-"));
  process.env.DECODE_DB_PATH = join(dir, "t.db");

  const { getDb } = await import("@/db/client");
  const { executions } = await import("@/db/schema");
  const db = getDb();
  const now = new Date().toISOString();
  db.insert(executions)
    .values([
      {
        id: "exec:ready-publish",
        lane: "content",
        title: "Ready for publish",
        body: "body",
        status: "ready",
        createdAt: now,
      },
      {
        id: "exec:ready-dismiss",
        lane: "content",
        title: "Ready for dismiss",
        body: "body",
        status: "ready",
        createdAt: now,
      },
      {
        id: "exec:draft",
        lane: "content",
        title: "Draft item",
        body: "body",
        status: "draft",
        createdAt: now,
      },
    ])
    .run();

  POST = (await import("./route")).POST as any;
});

function req(action: string): Request {
  return new Request(`http://localhost/api/executions/x?action=${action}`, { method: "POST" });
}

describe("POST /api/executions/[id]", () => {
  it("rejects unknown actions", async () => {
    const res = await POST(req("delete"), { params: Promise.resolve({ id: "exec:ready-publish" }) });
    expect(res.status).toBe(400);
  });

  it("404s for a missing execution", async () => {
    const res = await POST(req("publish"), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("rejects publish/dismiss on an execution that isn't ready", async () => {
    const res = await POST(req("publish"), { params: Promise.resolve({ id: "exec:draft" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("execution is not ready (status: draft)");
  });

  it("publish marks a ready execution as published", async () => {
    const res = await POST(req("publish"), { params: Promise.resolve({ id: "exec:ready-publish" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.row.status).toBe("published");
  });

  it("dismiss sends a ready execution back to draft", async () => {
    const res = await POST(req("dismiss"), { params: Promise.resolve({ id: "exec:ready-dismiss" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.row.status).toBe("draft");
  });
});
