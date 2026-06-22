import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any */
let signalsGET: (req: Request) => Promise<Response>;
let sourcesGET: () => Promise<Response>;
let discoverPOST: () => Promise<Response>;
let healthGET: () => Promise<Response>;

// explicit "everything off" sources so listing/discovery never touches the network
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

let CFG_A = "";
let CFG_B = "";

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "api-"));
  process.env.DECODE_DB_PATH = join(dir, "t.db");
  const vault = join(dir, "vault");
  mkdirSync(vault, { recursive: true });

  CFG_A = join(dir, "a.config.yml");
  writeFileSync(
    CFG_A,
    `vault: ${vault}\nbusiness:\n  name: Acme\n  keywords: [radiology]\n${EMPTY_SOURCES}`,
  );
  // CFG_B has no keywords/name so even the keyword-fallback sources (HN) skip
  CFG_B = join(dir, "b.config.yml");
  writeFileSync(
    CFG_B,
    `vault: ${vault}\nbusiness:\n  name: ""\n  keywords: []\n${EMPTY_SOURCES}`,
  );

  process.env.DECODE_CONFIG = CFG_A;

  const { getDb } = await import("@/db/client");
  const { signals, sourceHealth, jobRuns } = await import("@/db/schema");
  const db = getDb();
  const now = new Date().toISOString();

  db.insert(sourceHealth)
    .values({
      source: "rss",
      state: "closed",
      consecutiveFailures: 0,
      avgLatencyMs: 120,
      totalRuns: 5,
      totalFailures: 0,
      updatedAt: now,
    })
    .run();

  db.insert(jobRuns)
    .values({
      id: "run-1",
      jobId: "job-1",
      kind: "discovery",
      status: "ok",
      startedAt: now,
      finishedAt: now,
      durationMs: 42,
    })
    .run();

  db.insert(signals)
    .values([
      {
        id: "1",
        source: "rss",
        title: "Radiology AI",
        url: "https://x/1",
        urlHash: "h1",
        tags: ["rss"],
        score: 1,
        cluster: "radiology",
        status: "new",
        capturedAt: now,
      },
      {
        id: "2",
        source: "reddit",
        title: "Cooking blog",
        url: "https://x/2",
        urlHash: "h2",
        tags: ["reddit"],
        score: 0,
        cluster: "unclustered",
        status: "archived",
        capturedAt: now,
      },
    ])
    .run();

  signalsGET = (await import("@/app/api/signals/route")).GET as any;
  sourcesGET = (await import("@/app/api/sources/route")).GET as any;
  discoverPOST = (await import("@/app/api/discover/route")).POST as any;
  healthGET = (await import("@/app/api/health/route")).GET as any;
});

describe("GET /api/signals", () => {
  it("returns rows, total and clusters", async () => {
    const res = await signalsGET(new Request("http://t/api/signals"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.rows).toHaveLength(2);
    expect(body.clusters).toContain("radiology");
  });

  it("filters by source", async () => {
    const res = await signalsGET(
      new Request("http://t/api/signals?source=rss"),
    );
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].source).toBe("rss");
  });

  it("filters by status", async () => {
    const res = await signalsGET(
      new Request("http://t/api/signals?status=archived"),
    );
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].title).toBe("Cooking blog");
  });

  it("400s on an invalid limit", async () => {
    const res = await signalsGET(new Request("http://t/api/signals?limit=abc"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/sources", () => {
  it("lists all connectors and business info", async () => {
    const res = await sourcesGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business.name).toBe("Acme");
    expect(body.sources).toHaveLength(10);
    const rss = body.sources.find((s: any) => s.key === "rss");
    expect(rss.configured).toBe(false); // empty sources config
  });
});

describe("POST /api/discover", () => {
  it("runs the loop (all sources skipped → ok, 0 new)", async () => {
    process.env.DECODE_CONFIG = CFG_B; // no keywords/name → every source skips
    try {
      const res = await discoverPOST();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.totalNew).toBe(0);
      expect(body.perSource.every((p: any) => p.status === "skipped")).toBe(
        true,
      );
    } finally {
      process.env.DECODE_CONFIG = CFG_A;
    }
  });
});

describe("GET /api/health", () => {
  it("returns source health (breaker state + latency) and recent job runs", async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    const body = await res.json();

    const rss = body.sourceHealth.find((s: any) => s.source === "rss");
    expect(rss.state).toBe("closed");
    expect(rss.avgLatencyMs).toBe(120);

    expect(body.recentJobRuns).toHaveLength(1);
    expect(body.recentJobRuns[0].kind).toBe("discovery");
    expect(body.recentJobRuns[0].status).toBe("ok");
  });
});
