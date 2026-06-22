import { describe, it, expect, vi } from "vitest";
import type { ConnectorContext } from "../types";
import type { ResearchReport } from "@/research/last30days";
import { createLast30DaysConnector } from "./last30days";

function ctx(p: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    keywords: [],
    businessName: "Acme",
    config: undefined,
    env: {},
    fetchImpl: vi.fn(),
    ...p,
  };
}

const EMPTY_REPORT: ResearchReport = {
  topic: "T",
  rangeFrom: "2026-05-15",
  rangeTo: "2026-06-14",
  itemsBySource: {},
  errorsBySource: {},
  warnings: [],
};

const REPORT: ResearchReport = {
  topic: "Signal Desk",
  rangeFrom: "2026-05-15",
  rangeTo: "2026-06-14",
  itemsBySource: {
    reddit: [
      {
        title: "Post A",
        url: "https://reddit.com/a",
        snippet: "snippet a",
        author: "alice",
        publishedAt: "2026-06-01",
        engagement: { upvotes: 10, comments: 2 },
      },
    ],
    bluesky: [
      {
        title: "Post B",
        url: "https://bsky.app/b",
        snippet: "snippet b",
        engagement: {},
      },
    ],
  },
  errorsBySource: {},
  warnings: [],
};

describe("createLast30DaysConnector", () => {
  describe("state", () => {
    it("is unconfigured (disabled in config) when not enabled", () => {
      const connector = createLast30DaysConnector(vi.fn(), () => true);
      const state = connector.state(ctx({ config: {} }));
      expect(state.configured).toBe(false);
      expect((state as { reason: string }).reason).toMatch(/disabled/);
    });

    it("is unconfigured (script not found) when enabled but the script is missing", () => {
      const connector = createLast30DaysConnector(vi.fn(), () => false);
      const state = connector.state(ctx({ config: { enabled: true } }));
      expect(state.configured).toBe(false);
      expect((state as { reason: string }).reason).toMatch(/not found/);
    });

    it("is configured when enabled and the script is present", () => {
      const connector = createLast30DaysConnector(vi.fn(), () => true);
      const state = connector.state(ctx({ config: { enabled: true } }));
      expect(state.configured).toBe(true);
    });
  });

  describe("fetch", () => {
    it("flattens itemsBySource into RawSignal[], summing engagement into points", async () => {
      const run = vi.fn().mockResolvedValue(REPORT);
      const connector = createLast30DaysConnector(run, () => true);

      const out = await connector.fetch(
        ctx({ config: { enabled: true }, businessName: "Signal Desk", env: { FOO: "bar" } }),
      );

      expect(run).toHaveBeenCalledWith("Signal Desk", { quick: true }, { FOO: "bar" });
      expect(out).toEqual([
        {
          source: "last30days",
          title: "Post A",
          url: "https://reddit.com/a",
          author: "alice",
          publishedAt: "2026-06-01",
          tags: ["last30days", "reddit"],
          raw: "snippet a",
          points: 12,
          authorKey: "last30days:alice",
        },
        {
          source: "last30days",
          title: "Post B",
          url: "https://bsky.app/b",
          author: "",
          publishedAt: "",
          tags: ["last30days", "bluesky"],
          raw: "snippet b",
          points: undefined,
          authorKey: undefined,
        },
      ]);
    });

    it("returns [] when itemsBySource is empty", async () => {
      const run = vi.fn().mockResolvedValue(EMPTY_REPORT);
      const connector = createLast30DaysConnector(run, () => true);

      const out = await connector.fetch(ctx({ config: { enabled: true } }));
      expect(out).toEqual([]);
    });

    it("uses cfg.topic when set, falling back to businessName otherwise", async () => {
      const run = vi.fn().mockResolvedValue(EMPTY_REPORT);
      const connector = createLast30DaysConnector(run, () => true);

      await connector.fetch(
        ctx({ config: { enabled: true, topic: "My Topic" }, businessName: "Acme" }),
      );
      expect(run).toHaveBeenLastCalledWith("My Topic", { quick: true }, {});

      await connector.fetch(ctx({ config: { enabled: true }, businessName: "Acme" }));
      expect(run).toHaveBeenLastCalledWith("Acme", { quick: true }, {});
    });
  });
});
