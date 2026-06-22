import { describe, it, expect } from "vitest";
import type { EventRow } from "@/db/schema";
import { createDecodeEventHandlers } from "./decodeEvents";
import { DEFAULT_NOTIFY_CONFIG } from "@/discovery/config";

function ev(type: string, payload: unknown): EventRow {
  return {
    id: "e1",
    type,
    payload,
    status: "new",
    createdAt: "2026-01-01T00:00:00.000Z",
    processedAt: null,
  };
}

describe("createDecodeEventHandlers", () => {
  const handlers = createDecodeEventHandlers(DEFAULT_NOTIFY_CONFIG);

  it("formats decode.insight_created with the cluster and trend", async () => {
    const message = await handlers["decode.insight_created"]!(
      ev("decode.insight_created", { insightId: "insight:radiology", cluster: "radiology", trend: "rising radiology interest" }),
    );

    expect(message).toEqual({
      title: "New insight: radiology",
      body: "rising radiology interest",
      priority: "low", // decode.insight_created severity defaults to "low"
    });
  });

  it("formats decode.execution_ready with the lane and decision title", async () => {
    const message = await handlers["decode.execution_ready"]!(
      ev("decode.execution_ready", { decisionId: "decision:1", title: "Publish content on radiology", lane: "content" }),
    );

    expect(message).toEqual({
      title: "Ready to execute",
      body: "[content] Publish content on radiology",
      priority: "default", // decode.execution_ready severity defaults to "medium"
    });
  });

  it("formats discovery.run_failed with the error message", async () => {
    const message = await handlers["discovery.run_failed"]!(
      ev("discovery.run_failed", { runId: "run1", error: "all sources failed" }),
    );

    expect(message).toEqual({
      title: "Discovery run failed",
      body: "all sources failed",
      priority: "high", // discovery.run_failed severity defaults to "high"
    });
  });

  it("formats source.breaker_opened with the source name", async () => {
    const message = await handlers["source.breaker_opened"]!(
      ev("source.breaker_opened", { source: "reddit" }),
    );

    expect(message).toEqual({
      title: "Source breaker opened",
      body: "reddit is now skipped (circuit open)",
      priority: "default", // source.breaker_opened severity defaults to "medium"
    });
  });
});
