import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { seoRecommendations } from "@/db/schema";
import { applyRecommendations, fingerprint } from "./diff";
import { openRecommendations, setRecommendationStatus } from "./store";
import type { RecommendationDraft } from "./types";

function draft(over: Partial<RecommendationDraft> = {}): RecommendationDraft {
  return {
    category: "geo",
    title: "Add llms.txt",
    detail: "Create a /llms.txt",
    executionSteps: ["Write llms.txt"],
    impact: "medium",
    effort: "low",
    evidence: [],
    ...over,
  };
}

describe("fingerprint", () => {
  it("is stable across title casing/whitespace and folds in the target url", () => {
    const a = fingerprint("s1", draft({ title: "Add  LLMS.txt" }));
    const b = fingerprint("s1", draft({ title: "add llms.txt" }));
    expect(a).toBe(b);
    const c = fingerprint("s1", draft({ targetUrl: "https://x.com/p" }));
    expect(c).not.toBe(a);
  });
});

describe("applyRecommendations (the weekly diff)", () => {
  it("first run inserts everything as new", () => {
    const db = createDb(":memory:");
    const res = applyRecommendations(db, "s1", "a1", [draft(), draft({ title: "Add FAQ schema" })]);
    expect(res.created).toBe(2);
    expect(res.updated).toBe(0);
    const recs = openRecommendations(db, "s1", "a1");
    expect(recs).toHaveLength(2);
    expect(recs.every((r) => r.isNew)).toBe(true);
  });

  it("an identical second run creates nothing new", () => {
    const db = createDb(":memory:");
    applyRecommendations(db, "s1", "a1", [draft()]);
    const res = applyRecommendations(db, "s1", "a2", [draft()]);
    expect(res.created).toBe(0);
    expect(res.updated).toBe(1);
    const recs = openRecommendations(db, "s1", "a2");
    expect(recs).toHaveLength(1);
    expect(recs[0]!.isNew).toBe(false);
    expect(recs[0]!.firstSeenAuditId).toBe("a1");
    expect(recs[0]!.lastSeenAuditId).toBe("a2");
  });

  it("refreshes content (impact/detail) on re-detection", () => {
    const db = createDb(":memory:");
    applyRecommendations(db, "s1", "a1", [draft({ impact: "low" })]);
    applyRecommendations(db, "s1", "a2", [draft({ impact: "high", detail: "now urgent" })]);
    const row = db
      .select()
      .from(seoRecommendations)
      .where(eq(seoRecommendations.siteId, "s1"))
      .get();
    expect(row?.impact).toBe("high");
    expect(row?.detail).toBe("now urgent");
  });

  it("a done item is never resurfaced even if still detected", () => {
    const db = createDb(":memory:");
    applyRecommendations(db, "s1", "a1", [draft()]);
    const rec = openRecommendations(db, "s1")[0]!;
    setRecommendationStatus(db, rec.id, "done");
    applyRecommendations(db, "s1", "a2", [draft()]);
    expect(openRecommendations(db, "s1")).toHaveLength(0);
  });

  it("auto-resolves an open item after it goes missing for N runs", () => {
    const db = createDb(":memory:");
    applyRecommendations(db, "s1", "a1", [draft()], { autoResolveAfterRuns: 2 });
    expect(openRecommendations(db, "s1")).toHaveLength(1);
    applyRecommendations(db, "s1", "a2", [], { autoResolveAfterRuns: 2 });
    expect(openRecommendations(db, "s1")).toHaveLength(1);
    const res = applyRecommendations(db, "s1", "a3", [], { autoResolveAfterRuns: 2 });
    expect(res.autoResolved).toBe(1);
    expect(openRecommendations(db, "s1")).toHaveLength(0);
  });
});
