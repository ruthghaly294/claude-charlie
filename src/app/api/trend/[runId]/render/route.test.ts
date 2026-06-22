import { describe, it, expect, beforeAll, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ensureTrendWorker = vi.fn();
vi.mock("@/jobs/inProcessWorker", () => ({ ensureTrendWorker }));

/* eslint-disable @typescript-eslint/no-explicit-any */
let POST: (req: Request, ctx: { params: Promise<{ runId: string }> }) => Promise<Response>;
let db: any;
let trendRuns: any;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "trend-render-api-"));
  process.env.DECODE_DB_PATH = join(dir, "t.db");

  const dbClient = await import("@/db/client");
  const schema = await import("@/db/schema");
  trendRuns = schema.trendRuns;
  db = dbClient.getDb();

  db.insert(trendRuns)
    .values([
      {
        id: "run:awaiting",
        topic: "topic a",
        mode: "live",
        assetStyle: "standard",
        status: "awaiting_review",
        stages: [],
        reviewEnabled: true,
        renderContext: {
          topic: "topic a",
          brief: { topic: "topic a" },
          exemplars: [],
          coverPrompt: "original cover prompt",
          videoPrompt: "original video prompt",
          soundsCatalogued: 0,
          assetStyle: "standard",
          ideaScore: 80,
        },
        createdAt: "2026-06-18T00:00:00.000Z",
        updatedAt: "2026-06-18T00:00:00.000Z",
      },
      {
        id: "run:running",
        topic: "topic b",
        mode: "live",
        assetStyle: "standard",
        status: "running",
        stages: [],
        reviewEnabled: false,
        renderContext: null,
        createdAt: "2026-06-18T00:00:00.000Z",
        updatedAt: "2026-06-18T00:00:00.000Z",
      },
      {
        id: "run:no-context",
        topic: "topic c",
        mode: "live",
        assetStyle: "standard",
        status: "awaiting_review",
        stages: [],
        reviewEnabled: true,
        renderContext: null,
        createdAt: "2026-06-18T00:00:00.000Z",
        updatedAt: "2026-06-18T00:00:00.000Z",
      },
    ])
    .run();

  POST = (await import("./route")).POST as any;
});

function req(body: unknown = {}): Request {
  return new Request("http://localhost/api/trend/x/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/trend/[runId]/render", () => {
  it("404s for a missing run", async () => {
    const res = await POST(req(), { params: Promise.resolve({ runId: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("409s for a run that isn't awaiting review", async () => {
    const res = await POST(req(), { params: Promise.resolve({ runId: "run:running" }) });
    expect(res.status).toBe(409);
  });

  it("409s for an awaiting-review run with no render context", async () => {
    const res = await POST(req(), { params: Promise.resolve({ runId: "run:no-context" }) });
    expect(res.status).toBe(409);
  });

  it("merges operator prompt edits, persists them, and enqueues the render job", async () => {
    const { eq } = await import("drizzle-orm");
    const res = await POST(
      req({ coverPrompt: "edited cover", videoPrompt: "edited video" }),
      { params: Promise.resolve({ runId: "run:awaiting" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.coverPrompt).toBe("edited cover");
    expect(body.videoPrompt).toBe("edited video");

    const row = db.select().from(trendRuns).where(eq(trendRuns.id, "run:awaiting")).get();
    expect(row.renderContext.coverPrompt).toBe("edited cover");
    expect(row.renderContext.videoPrompt).toBe("edited video");
    expect(row.renderContext.topic).toBe("topic a");

    expect(ensureTrendWorker).toHaveBeenCalled();

    const { jobs } = await import("@/db/schema");
    const jobRows = db.select().from(jobs).all();
    const renderJob = jobRows.find((j: any) => j.kind === "trend-imitation");
    expect(renderJob).toBeDefined();
    expect(renderJob.payload).toEqual({ runId: "run:awaiting", phase: "render" });
  });

  it("falls back to the existing prompts when an edit is blank", async () => {
    const { eq } = await import("drizzle-orm");
    db.insert(trendRuns)
      .values({
        id: "run:blank-edit",
        topic: "topic d",
        mode: "live",
        assetStyle: "standard",
        status: "awaiting_review",
        stages: [],
        reviewEnabled: true,
        renderContext: {
          topic: "topic d",
          brief: { topic: "topic d" },
          exemplars: [],
          coverPrompt: "keep this cover",
          videoPrompt: "keep this video",
          soundsCatalogued: 0,
          assetStyle: "standard",
          ideaScore: 70,
        },
        createdAt: "2026-06-18T00:00:00.000Z",
        updatedAt: "2026-06-18T00:00:00.000Z",
      })
      .run();

    const res = await POST(req({ coverPrompt: "   ", videoPrompt: "" }), {
      params: Promise.resolve({ runId: "run:blank-edit" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.coverPrompt).toBe("keep this cover");
    expect(body.videoPrompt).toBe("keep this video");

    const row = db.select().from(trendRuns).where(eq(trendRuns.id, "run:blank-edit")).get();
    expect(row.renderContext.coverPrompt).toBe("keep this cover");
    expect(row.renderContext.videoPrompt).toBe("keep this video");
  });
});
