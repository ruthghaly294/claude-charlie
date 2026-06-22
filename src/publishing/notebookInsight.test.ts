import { describe, it, expect, vi } from "vitest";
import { createDb, type DB } from "@/db/client";
import { insights, notebooklmSettings } from "@/db/schema";
import { parseConfig, type DecodeConfig } from "@/discovery/config";
import type { NotebookInsight } from "@/research/notebookLm";
import {
  runNotebookInsight,
  resolveNotebookLmSettings,
  type NotebookLmClient,
  type NotebookInsightDeps,
} from "./notebookInsight";

const insight = (): NotebookInsight => ({ notebookId: "nb-1", text: "the surprising angle", citations: ["Book A"] });

function fakeClient(over: Partial<NotebookLmClient> = {}): NotebookLmClient {
  return {
    configured: true,
    addSources: vi.fn(async () => {}),
    query: vi.fn(async () => insight()),
    ...over,
  };
}

function deps(client: NotebookLmClient): NotebookInsightDeps {
  return { client, now: () => "2026-06-19T00:00:00.000Z", id: () => "id-1" };
}

function enabledConfig(mode: "discovery" | "existing" = "discovery"): DecodeConfig {
  const c = parseConfig({});
  c.notebooklm = { enabled: true, mode, notebookId: "nb-1", maxSources: 2, cliTimeoutMs: 1000 };
  return c;
}

describe("runNotebookInsight", () => {
  it("discovery mode: adds capped sources, queries, and persists the insight", async () => {
    const db: DB = createDb(":memory:");
    const client = fakeClient();
    const out = await runNotebookInsight(
      db,
      enabledConfig("discovery"),
      "AI coding agents",
      { sourceUrls: ["https://a", "https://b", "https://c"] },
      deps(client),
    );

    expect(out?.text).toBe("the surprising angle");
    expect(client.addSources).toHaveBeenCalledWith("nb-1", ["https://a", "https://b"]); // capped at maxSources=2
    expect(client.query).toHaveBeenCalledTimes(1);

    const rows = db.select().from(insights).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe("the surprising angle");
    expect(rows[0]!.cluster).toBe("notebooklm");
    expect(rows[0]!.evidence).toEqual(["Book A"]);
  });

  it("existing mode: queries directly without adding sources", async () => {
    const db = createDb(":memory:");
    const client = fakeClient();
    await runNotebookInsight(db, enabledConfig("existing"), "topic", { sourceUrls: ["https://a"] }, deps(client));
    expect(client.addSources).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("returns null when disabled", async () => {
    const db = createDb(":memory:");
    const c = enabledConfig();
    c.notebooklm.enabled = false;
    const client = fakeClient();
    expect(await runNotebookInsight(db, c, "t", {}, deps(client))).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });

  it("returns null when cookies are not imported (client not configured)", async () => {
    const db = createDb(":memory:");
    const client = fakeClient({ configured: false });
    expect(await runNotebookInsight(db, enabledConfig(), "t", {}, deps(client))).toBeNull();
  });

  it("returns null when no notebook is selected", async () => {
    const db = createDb(":memory:");
    const c = enabledConfig();
    c.notebooklm.notebookId = "";
    expect(await runNotebookInsight(db, c, "t", {}, deps(fakeClient()))).toBeNull();
  });

  it("propagates CLI failures (so the standalone job/CLI surfaces them)", async () => {
    const db = createDb(":memory:");
    const client = fakeClient({ query: vi.fn(async () => { throw new Error("cli boom"); }) });
    await expect(runNotebookInsight(db, enabledConfig(), "t", {}, deps(client))).rejects.toThrow(/cli boom/);
  });
});

describe("resolveNotebookLmSettings", () => {
  it("lets the DB row override config defaults", () => {
    const db = createDb(":memory:");
    db.insert(notebooklmSettings)
      .values({ id: "default", enabled: true, mode: "existing", notebookId: "nb-99", updatedAt: "now" })
      .run();
    const resolved = resolveNotebookLmSettings(db, parseConfig({}));
    expect(resolved).toMatchObject({ enabled: true, mode: "existing", notebookId: "nb-99" });
  });

  it("falls back to config defaults when no row exists", () => {
    const db = createDb(":memory:");
    const resolved = resolveNotebookLmSettings(db, enabledConfig("discovery"));
    expect(resolved).toMatchObject({ enabled: true, mode: "discovery", notebookId: "nb-1", maxSources: 2 });
  });
});
