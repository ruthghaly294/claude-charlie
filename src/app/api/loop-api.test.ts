import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any */
let decodePOST: () => Promise<Response>;
let insightsGET: () => Promise<Response>;
let decisionsGET: () => Promise<Response>;
let executionsGET: () => Promise<Response>;

const EMPTY_SOURCES = `sources:
  rss: []
  github_trending: { topics: [] }
  reddit: { subreddits: [] }
  hackernews: { query: "" }
  youtube: { queries: [] }
  google_cse: { enabled: false }
  twitter: { enabled: false }
  producthunt: { enabled: false }
`;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "loop-api-"));
  process.env.DECODE_DB_PATH = join(dir, "t.db");
  const vault = join(dir, "vault");
  mkdirSync(vault, { recursive: true });

  const cfg = join(dir, "decode.config.yml");
  writeFileSync(
    cfg,
    `vault: ${vault}\nbusiness:\n  name: Acme\n  keywords: [radiology, frcr]\nscoring:\n  keep_threshold: 0.4\n${EMPTY_SOURCES}`,
  );
  process.env.DECODE_CONFIG = cfg;

  const { getDb } = await import("@/db/client");
  const { signals } = await import("@/db/schema");
  const db = getDb();
  const now = new Date().toISOString();
  db.insert(signals)
    .values([
      {
        id: "a",
        source: "rss",
        title: "Radiology FRCR advances",
        url: "https://x/a",
        urlHash: "ha",
        capturedAt: now,
        status: "new",
      },
      {
        id: "b",
        source: "rss",
        title: "Radiology imaging update",
        url: "https://x/b",
        urlHash: "hb",
        capturedAt: now,
        status: "new",
      },
      {
        id: "c",
        source: "rss",
        title: "Cooking pasta tonight",
        url: "https://x/c",
        urlHash: "hc",
        capturedAt: now,
        status: "new",
      },
    ])
    .run();

  decodePOST = (await import("@/app/api/decode/route")).POST as any;
  insightsGET = (await import("@/app/api/insights/route")).GET as any;
  decisionsGET = (await import("@/app/api/decisions/route")).GET as any;
  executionsGET = (await import("@/app/api/executions/route")).GET as any;
});

describe("POST /api/decode", () => {
  it("runs the loop and returns a 4-panel digest", async () => {
    const res = await decodePOST();
    expect(res.status).toBe(200);
    const digest = await res.json();
    expect(digest.signals.kept).toBe(2);
    expect(digest.signals.archived).toBe(1);
    expect(digest.insights.count).toBeGreaterThanOrEqual(1);
    expect(digest.decisions.count).toBeGreaterThanOrEqual(1);
    expect(digest.executions.count).toBeGreaterThanOrEqual(1);
  });
});

describe("loop read routes", () => {
  it("GET /api/insights lists insights", async () => {
    const body = await (await insightsGET()).json();
    expect(body.rows.length).toBeGreaterThanOrEqual(1);
    expect(body.rows[0].cluster).toBe("radiology");
  });

  it("GET /api/decisions lists decisions ordered by priority", async () => {
    const body = await (await decisionsGET()).json();
    expect(body.rows.length).toBeGreaterThanOrEqual(1);
    expect(body.rows[0].priority).toBeGreaterThan(0);
  });

  it("GET /api/executions lists drafted assets", async () => {
    const body = await (await executionsGET()).json();
    expect(body.rows.length).toBeGreaterThanOrEqual(1);
    expect(body.rows[0].status).toBe("draft");
  });
});
