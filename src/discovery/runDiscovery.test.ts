import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtempSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@/db/client";
import { signals, discoveryRuns, entities, events } from "@/db/schema";
import { parseConfig, type DecodeConfig } from "./config";
import type { Connector, RawSignal } from "./types";
import { runDiscovery } from "./runDiscovery";

function fake(
  key: string,
  out: RawSignal[],
  behavior: "ok" | "throw" | "skip" = "ok",
): Connector {
  return {
    key,
    label: key,
    requiresKeys: [],
    state: () =>
      behavior === "skip"
        ? { configured: false, reason: "off" }
        : { configured: true },
    fetch: async () => {
      if (behavior === "throw") throw new Error("boom");
      return out;
    },
  };
}

const sig = (over: Partial<RawSignal>): RawSignal => ({
  source: "rss",
  title: "t",
  url: "https://x/1",
  author: "",
  publishedAt: "",
  tags: ["rss"],
  raw: "",
  ...over,
});

function cfg(over: Partial<DecodeConfig> = {}): DecodeConfig {
  return {
    ...parseConfig({}),
    keywords: ["radiology", "frcr"],
    keepThreshold: 0.4,
    ...over,
  };
}

describe("runDiscovery", () => {
  it("persists new signals, scores them, and records a run", async () => {
    const db = createDb(":memory:");
    const conns = [
      fake("rss", [sig({ url: "https://x/1", title: "Radiology frcr news" })]),
    ];
    const r = await runDiscovery(db, cfg(), { connectors: conns });
    expect(r.totalNew).toBe(1);
    expect(r.status).toBe("ok");
    const row = db.select().from(signals).get();
    expect(row?.score).toBe(1);
    expect(row?.status).toBe("new");
    const run = db.select().from(discoveryRuns).get();
    expect(run?.totalNew).toBe(1);
  });

  it("dedups within a batch and against the DB on re-run", async () => {
    const db = createDb(":memory:");
    const conns = [
      fake("a", [
        sig({ url: "https://dup/1", title: "one" }),
        sig({ url: "https://dup/1", title: "dupe" }),
      ]),
    ];
    const first = await runDiscovery(db, cfg(), { connectors: conns });
    expect(first.totalNew).toBe(1);
    const second = await runDiscovery(db, cfg(), { connectors: conns });
    expect(second.totalNew).toBe(0);
    expect(db.select().from(signals).all()).toHaveLength(1);
  });

  it("isolates a throwing connector (partial status) but persists the rest", async () => {
    const db = createDb(":memory:");
    const conns = [
      fake("bad", [], "throw"),
      fake("good", [sig({ url: "https://x/ok", title: "radiology" })]),
    ];
    const r = await runDiscovery(db, cfg(), { connectors: conns });
    expect(r.status).toBe("partial");
    expect(r.totalNew).toBe(1);
    expect(r.perSource.find((p) => p.source === "bad")?.status).toBe("error");
    expect(r.perSource.find((p) => p.source === "bad")?.error).toContain(
      "boom",
    );
  });

  it("normalises stored source to the connector key (github_trending, not github)", async () => {
    const db = createDb(":memory:");
    // connector key differs from the source label its RawSignal carries
    const conns = [
      fake("github_trending", [
        sig({ source: "github", url: "https://gh/1", title: "radiology repo" }),
      ]),
    ];
    const r = await runDiscovery(db, cfg(), { connectors: conns });
    expect(db.select().from(signals).get()?.source).toBe("github_trending");
    expect(r.perSource[0]?.source).toBe("github_trending");
    expect(r.perSource[0]?.added).toBe(1);
  });

  it("records skipped connectors", async () => {
    const db = createDb(":memory:");
    const r = await runDiscovery(db, cfg(), {
      connectors: [fake("x", [], "skip")],
    });
    expect(r.perSource[0]?.status).toBe("skipped");
    expect(r.totalNew).toBe(0);
  });

  it("emits discovery.run_failed when every connector errors", async () => {
    const db = createDb(":memory:");
    const r = await runDiscovery(db, cfg(), {
      connectors: [fake("bad", [], "throw")],
    });
    expect(r.status).toBe("error");

    const ev = db.select().from(events).where(eq(events.type, "discovery.run_failed")).get();
    expect(ev).toBeDefined();
    expect(ev?.payload).toMatchObject({ runId: r.runId });
    expect((ev?.payload as { error: string }).error).toContain("boom");
  });

  it("does not emit discovery.run_failed on an ok or partial run", async () => {
    const db = createDb(":memory:");
    await runDiscovery(db, cfg(), {
      connectors: [fake("good", [sig({ url: "https://x/ok", title: "radiology" })])],
    });
    const ev = db.select().from(events).where(eq(events.type, "discovery.run_failed")).get();
    expect(ev).toBeUndefined();
  });

  it("marks below-threshold signals as archived", async () => {
    const db = createDb(":memory:");
    const conns = [
      fake("rss", [sig({ url: "https://x/2", title: "frcr only", raw: "" })]),
    ];
    // only 1 of 2 keywords → score 0.5 ≥ 0.4 = new; raise threshold to force archive
    await runDiscovery(db, cfg({ keepThreshold: 0.9 }), { connectors: conns });
    expect(db.select().from(signals).get()?.status).toBe("archived");
  });

  it("writes vault notes when writeVault is on and vault exists", async () => {
    const db = createDb(":memory:");
    const vault = mkdtempSync(join(tmpdir(), "vault-"));
    mkdirSync(join(vault, "01-Signals"), { recursive: true });
    const conns = [
      fake("rss", [sig({ url: "https://x/3", title: "Radiology piece" })]),
    ];
    await runDiscovery(db, cfg({ vault }), {
      connectors: conns,
      writeVault: true,
    });
    const notes = readdirSync(join(vault, "01-Signals")).filter((f) =>
      f.endsWith(".md"),
    );
    expect(notes.length).toBe(1);
  });

  it("ignores vault writing when the vault path does not exist", async () => {
    const db = createDb(":memory:");
    const conns = [
      fake("rss", [sig({ url: "https://x/4", title: "radiology" })]),
    ];
    const r = await runDiscovery(db, cfg({ vault: "/no/such/vault" }), {
      connectors: conns,
      writeVault: true,
    });
    expect(r.totalNew).toBe(1); // persisted to DB regardless
    expect(existsSync("/no/such/vault")).toBe(false);
  });

  it("boosts score by per-source social percentile (points/comments/views)", async () => {
    const db = createDb(":memory:");
    const conns = [
      fake("hackernews", [
        sig({ url: "https://x/hi", title: "hi", points: 100 }),
        sig({ url: "https://x/lo", title: "lo", points: 1 }),
      ]),
    ];
    await runDiscovery(db, cfg({ keywords: [] }), { connectors: conns });
    const rows = db.select().from(signals).all();
    const hi = rows.find((r) => r.url === "https://x/hi")!;
    const lo = rows.find((r) => r.url === "https://x/lo")!;
    expect(hi.socialScore).toBe(1);
    expect(lo.socialScore).toBe(0);
    expect(hi.score).toBeGreaterThan(lo.score!);
    expect(hi.score).toBe(1); // keywordScore 1 * (0.5 + 0.5*1)
    expect(lo.score).toBe(0.5); // keywordScore 1 * (0.5 + 0.5*0)
  });

  it("merges clusters across sources when titles share enough tokens", async () => {
    const db = createDb(":memory:");
    const conns = [
      fake("rss", [sig({ url: "https://x/1", title: "Radiology breakthrough conference talk" })]),
      fake("hackernews", [
        sig({ url: "https://x/2", title: "FRCR breakthrough conference talk" }),
      ]),
    ];
    await runDiscovery(db, cfg(), { connectors: conns });
    const rows = db.select().from(signals).all();
    const clusters = new Set(rows.map((r) => r.cluster));
    expect(clusters.size).toBe(1);
    expect([...clusters][0]).toBe("frcr"); // lexicographically smaller of "frcr"/"radiology"
  });

  it("drops excess signals per authorKey beyond the per-author cap", async () => {
    const db = createDb(":memory:");
    const items = Array.from({ length: 5 }, (_, i) =>
      sig({ url: `https://x/${i}`, title: `radiology frcr ${i}`, authorKey: "reddit:jane" }),
    );
    const conns = [fake("reddit", items)];
    const r = await runDiscovery(db, cfg(), { connectors: conns });
    expect(r.totalNew).toBe(3);
    expect(db.select().from(signals).all()).toHaveLength(3);
  });

  it("seeds configured research entities into the entities table", async () => {
    const db = createDb(":memory:");
    const conns = [fake("rss", [])];
    await runDiscovery(
      db,
      cfg({
        seedEntities: [{ keyword: "web scraping", kind: "subreddit", value: "scrapy" }],
      }),
      { connectors: conns },
    );
    const rows = db.select().from(entities).all();
    expect(rows.some((r) => r.kind === "subreddit" && r.value === "scrapy")).toBe(true);
  });
});
