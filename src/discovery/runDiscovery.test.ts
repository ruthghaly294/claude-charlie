import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@/db/client";
import { signals, discoveryRuns } from "@/db/schema";
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
});
