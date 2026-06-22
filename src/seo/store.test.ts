import { describe, it, expect } from "vitest";
import { createDb } from "@/db/client";
import {
  finishAudit,
  getSite,
  insertPages,
  latestAudit,
  listSites,
  openRecommendations,
  setRecommendationStatus,
  startAudit,
  upsertSite,
} from "./store";
import { seoRecommendations } from "@/db/schema";

function seedRec(
  db: ReturnType<typeof createDb>,
  over: Partial<typeof seoRecommendations.$inferInsert> = {},
): void {
  db.insert(seoRecommendations)
    .values({
      id: over.id ?? "r1",
      siteId: over.siteId ?? "s1",
      fingerprint: over.fingerprint ?? "fp1",
      category: over.category ?? "seo",
      title: over.title ?? "Add meta description",
      firstSeenAuditId: over.firstSeenAuditId ?? "a1",
      lastSeenAuditId: over.lastSeenAuditId ?? "a1",
      firstSeenAt: over.firstSeenAt ?? "2026-01-01T00:00:00.000Z",
      lastSeenAt: over.lastSeenAt ?? "2026-01-01T00:00:00.000Z",
      ...over,
    })
    .run();
}

describe("seo store", () => {
  it("upserts a site, deriving a stable id from the domain", () => {
    const db = createDb(":memory:");
    const a = upsertSite(db, { domain: "https://frcrbank.com", keywords: ["frcr"] });
    expect(a.id).toBe("frcrbank-com");
    const b = upsertSite(db, { domain: "https://frcrbank.com", keywords: ["frcr", "radiology"] });
    expect(b.id).toBe("frcrbank-com");
    expect(getSite(db, "frcrbank-com")?.keywords).toEqual(["frcr", "radiology"]);
    expect(listSites(db)).toHaveLength(1);
  });

  it("records and finishes an audit, returning the latest", () => {
    const db = createDb(":memory:");
    upsertSite(db, { id: "s1", domain: "https://x.com" });
    const auditId = startAudit(db, "s1", () => "2026-02-01T00:00:00.000Z");
    finishAudit(db, auditId, {
      status: "ok",
      scores: { seo: 80, geo: 60, competitor: 70, overall: 70 },
      newRecCount: 3,
    });
    const audit = latestAudit(db, "s1");
    expect(audit?.status).toBe("ok");
    expect(audit?.scores?.overall).toBe(70);
    expect(audit?.newRecCount).toBe(3);
  });

  it("flags recommendations first-seen in the latest audit as new", () => {
    const db = createDb(":memory:");
    seedRec(db, { id: "old", fingerprint: "old", firstSeenAuditId: "a1", lastSeenAuditId: "a2" });
    seedRec(db, { id: "fresh", fingerprint: "fresh", firstSeenAuditId: "a2", lastSeenAuditId: "a2" });
    const recs = openRecommendations(db, "s1", "a2");
    const fresh = recs.find((r) => r.id === "fresh");
    const old = recs.find((r) => r.id === "old");
    expect(fresh?.isNew).toBe(true);
    expect(old?.isNew).toBe(false);
  });

  it("marking a recommendation done hides it from the open list", () => {
    const db = createDb(":memory:");
    seedRec(db);
    expect(openRecommendations(db, "s1")).toHaveLength(1);
    setRecommendationStatus(db, "r1", "done", () => "2026-03-01T00:00:00.000Z");
    expect(openRecommendations(db, "s1")).toHaveLength(0);
  });

  it("persists crawled pages", () => {
    const db = createDb(":memory:");
    insertPages(db, [
      {
        id: "p1",
        auditId: "a1",
        siteId: "s1",
        role: "self",
        url: "https://x.com/",
        title: "Home",
      },
    ]);
    const recs = openRecommendations(db, "s1");
    expect(recs).toHaveLength(0);
  });
});
