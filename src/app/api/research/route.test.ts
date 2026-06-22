import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResearchReport } from "@/research/last30days";

const runLast30Days = vi.fn();
vi.mock("@/research/last30days", () => ({ runLast30Days }));

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "research-api-"));
  process.env.DECODE_DB_PATH = join(dir, "t.db");
});

function postReq(body: unknown): Request {
  return new Request("http://t/api/research", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const FIXTURE_REPORT: ResearchReport = {
  topic: "claude code",
  rangeFrom: "2026-05-13",
  rangeTo: "2026-06-12",
  itemsBySource: { hackernews: [] },
  errorsBySource: {},
  warnings: [],
};

const FIXTURE_REPORT_WITH_ITEMS: ResearchReport = {
  topic: "ai agents",
  rangeFrom: "2026-05-13",
  rangeTo: "2026-06-12",
  itemsBySource: {
    hackernews: [
      {
        title: "AI Agents Take Over Workflows",
        url: "https://example.com/agents",
        snippet: "",
        engagement: { points: 50 },
      },
    ],
  },
  errorsBySource: {},
  warnings: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("POST /api/research", () => {
  beforeEach(() => {
    runLast30Days.mockReset();
  });

  it("400s on a too-short topic", async () => {
    const { POST } = await import("./route");
    const res = await POST(postReq({ topic: "a" }));
    expect(res.status).toBe(400);
    expect(runLast30Days).not.toHaveBeenCalled();
  });

  it("200s with the report and durationMs on success", async () => {
    runLast30Days.mockResolvedValue(FIXTURE_REPORT);
    const { POST } = await import("./route");

    const res = await POST(postReq({ topic: "claude code", quick: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report).toEqual(FIXTURE_REPORT);
    expect(body.topPicks).toEqual([]);
    expect(typeof body.durationMs).toBe("number");
    expect(runLast30Days).toHaveBeenCalledWith("claude code", { quick: true });
  });

  it("ranks items and surfaces them in topPicks", async () => {
    runLast30Days.mockResolvedValue(FIXTURE_REPORT_WITH_ITEMS);
    const { POST } = await import("./route");

    const res = await POST(postReq({ topic: "ai agents" }));
    expect(res.status).toBe(200);
    const body = await res.json();

    const ranked = body.report.itemsBySource.hackernews[0];
    expect(ranked.url).toBe("https://example.com/agents");
    expect(typeof ranked.score).toBe("number");
    expect(typeof ranked.cluster).toBe("string");

    expect(body.topPicks).toHaveLength(1);
    expect(body.topPicks[0].url).toBe("https://example.com/agents");
  });

  it("returns the error message on failure", async () => {
    runLast30Days.mockRejectedValue(new Error("boom"));
    const { POST } = await import("./route");

    const res = await POST(postReq({ topic: "claude code" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("boom");
  });

  it("409s a concurrent run while one is in flight", async () => {
    const d = deferred<ResearchReport>();
    runLast30Days.mockReturnValue(d.promise);
    const { POST } = await import("./route");

    const p1 = POST(postReq({ topic: "claude code" }));
    await new Promise((r) => setTimeout(r, 0));

    const res2 = await POST(postReq({ topic: "claude code" }));
    expect(res2.status).toBe(409);

    d.resolve(FIXTURE_REPORT);
    const res1 = await p1;
    expect(res1.status).toBe(200);
  });
});
