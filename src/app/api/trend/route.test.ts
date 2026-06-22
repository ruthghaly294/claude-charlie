import { describe, it, expect, beforeAll, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ensureTrendWorker = vi.fn();
vi.mock("@/jobs/inProcessWorker", () => ({ ensureTrendWorker }));

/* eslint-disable @typescript-eslint/no-explicit-any */
let POST: (req: Request) => Promise<Response>;
let db: any;
let jobs: any;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "trend-api-"));
  process.env.DECODE_DB_PATH = join(dir, "t.db");

  const dbClient = await import("@/db/client");
  const schema = await import("@/db/schema");
  jobs = schema.jobs;
  db = dbClient.getDb();

  POST = (await import("./route")).POST as any;
});

function req(body: unknown): Request {
  return new Request("http://localhost/api/trend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/trend — model picker validation", () => {
  it("400s on an unknown image model catalog key", async () => {
    const res = await POST(req({ topic: "t", mode: "demo", coverModelKey: "not-a-real-key" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unknown image model key/);
  });

  it("400s on an unknown video model catalog key", async () => {
    const res = await POST(req({ topic: "t", mode: "demo", videoModelKey: "not-a-real-key" }));
    expect(res.status).toBe(400);
  });

  it('400s on "custom" with a malformed slug', async () => {
    const res = await POST(req({ topic: "t", mode: "demo", coverModelKey: "custom", coverModelCustom: "not-a-slug" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/owner\/model/);
  });

  it('400s on "custom" with a blank value', async () => {
    const res = await POST(req({ topic: "t", mode: "demo", videoModelKey: "custom", videoModelCustom: "" }));
    expect(res.status).toBe(400);
  });

  it("runs demo mode with no model keys (auto) unaffected", async () => {
    const res = await POST(req({ topic: "t", mode: "demo" }));
    expect(res.status).toBe(200);
  });

  it("resolves a catalog model key and surfaces it on the cover/video stage events (demo)", async () => {
    const res = await POST(
      req({
        topic: "t",
        mode: "demo",
        coverModelKey: "flux-1.1-pro",
        videoModelKey: "kling-v1.6-pro",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const cover = body.stages.find((s: any) => s.stage === "cover").data;
    const video = body.stages.find((s: any) => s.stage === "video").data;
    expect(cover.model).toBe("black-forest-labs/flux-1.1-pro");
    expect(video.model).toBe("kwaivgi/kling-v1.6-pro");
  });

  it("accepts a valid custom model string and resolves it verbatim (demo)", async () => {
    const res = await POST(
      req({ topic: "t", mode: "demo", coverModelKey: "custom", coverModelCustom: "owner/model:v2" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const cover = body.stages.find((s: any) => s.stage === "cover").data;
    expect(cover.model).toBe("owner/model:v2");
  });

  it("includes the resolved coverModel/videoModel in the live job payload and response", async () => {
    const res = await POST(
      req({
        topic: "t",
        mode: "live",
        coverModelKey: "flux-1.1-pro",
        videoModelKey: "kling-v1.6-pro",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.coverModel).toBe("black-forest-labs/flux-1.1-pro");
    expect(body.videoModel).toBe("kwaivgi/kling-v1.6-pro");
    expect(ensureTrendWorker).toHaveBeenCalled();

    const jobRows = db.select().from(jobs).all();
    const job = jobRows.find((j: any) => j.payload?.runId === body.runId);
    expect(job.payload).toEqual(
      expect.objectContaining({
        coverModel: "black-forest-labs/flux-1.1-pro",
        videoModel: "kwaivgi/kling-v1.6-pro",
      }),
    );
  });
});
