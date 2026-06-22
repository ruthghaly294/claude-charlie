import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any */
let POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "decisions-api-"));
  process.env.DECODE_DB_PATH = join(dir, "t.db");

  const { getDb } = await import("@/db/client");
  const { decisions } = await import("@/db/schema");
  const db = getDb();
  db.insert(decisions)
    .values([
      {
        id: "decision:open",
        lane: "content",
        title: "Already open",
        rationale: "because",
        fromInsights: [],
        status: "open",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "decision:expired",
        lane: "content",
        title: "Expired one",
        rationale: "because radiology is trending",
        fromInsights: [],
        status: "expired",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-15T00:00:00.000Z",
        expiresAt: "2026-01-15T00:00:00.000Z",
      },
    ])
    .run();

  POST = (await import("./route")).POST as any;
});

function req(action: string): Request {
  return new Request(`http://localhost/api/decisions/x?action=${action}`, { method: "POST" });
}

describe("POST /api/decisions/[id]", () => {
  it("rejects unknown actions", async () => {
    const res = await POST(req("delete"), { params: Promise.resolve({ id: "decision:expired" }) });
    expect(res.status).toBe(400);
  });

  it("404s for a missing decision", async () => {
    const res = await POST(req("reopen"), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("rejects reopening a decision that's already open", async () => {
    const res = await POST(req("reopen"), { params: Promise.resolve({ id: "decision:open" }) });
    expect(res.status).toBe(400);
  });

  it("reopens an expired decision: status -> open, fresh timestamps, cleared expiresAt, audit note", async () => {
    const res = await POST(req("reopen"), { params: Promise.resolve({ id: "decision:expired" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.row.status).toBe("open");
    expect(body.row.expiresAt).toBeNull();
    expect(body.row.createdAt).toBe(body.row.updatedAt);
    expect(body.row.rationale).toContain("because radiology is trending");
    expect(body.row.rationale).toContain("manually reopened");
  });
});
