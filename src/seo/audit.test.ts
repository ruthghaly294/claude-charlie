import { describe, it, expect, vi } from "vitest";
import { createDb } from "@/db/client";
import { runSeoAudit } from "./audit";
import { latestAudit, latestRankings, openRecommendations, upsertSite } from "./store";
import type { CrawlOptions } from "./crawl";
import type { CrawlResult, PageMetrics, SiteSignals } from "./types";

function page(over: Partial<PageMetrics> = {}): PageMetrics {
  return {
    url: "https://frcrbank.com/",
    status: 200,
    title: "",
    metaDescription: "",
    canonical: "",
    ogTitle: "",
    h1s: [],
    headings: [],
    jsonLdTypes: [],
    wordCount: 120,
    imagesTotal: 0,
    imagesWithAlt: 0,
    internalLinks: 0,
    externalLinks: 0,
    hasViewportMeta: false,
    text: "frcr question bank",
    ...over,
  };
}

function signals(over: Partial<SiteSignals> = {}): SiteSignals {
  return { hasRobotsTxt: true, hasSitemap: false, hasLlmsTxt: false, blockedAiBots: [], robotsTxt: "", ...over };
}

/** Fake crawler: a weak self site and a strong competitor. */
const fakeCrawl = async (domain: string, _opts?: CrawlOptions): Promise<CrawlResult> => {
  if (domain.includes("frcrbank")) {
    return { domain: "https://frcrbank.com", pages: [page()], signals: signals() };
  }
  return {
    domain: "https://radiologycafe.com",
    pages: [page({ url: "https://radiologycafe.com/", jsonLdTypes: ["FAQPage"], wordCount: 900 })],
    signals: signals({ hasLlmsTxt: true }),
  };
};

describe("runSeoAudit", () => {
  it("crawls, persists, scores, and produces a fresh to-do list", async () => {
    const db = createDb(":memory:");
    const site = upsertSite(db, {
      id: "frcrbank",
      domain: "https://frcrbank.com",
      competitors: ["https://radiologycafe.com"],
      keywords: ["frcr"],
    });

    const summary = await runSeoAudit(db, site, {
      crawl: fakeCrawl,
      reasonerClient: null,
      runResearch: async () => ({
        topic: "frcr",
        rangeFrom: "",
        rangeTo: "",
        itemsBySource: { reddit: [{ title: "rapid reporting course", url: "u", snippet: "", engagement: {} }] },
        errorsBySource: {},
        warnings: [],
      }),
    });

    expect(summary.status).toBe("ok");
    expect(summary.pagesCrawled).toBe(1);
    expect(summary.recommendationsNew).toBeGreaterThan(0);
    expect(summary.scores.geo).toBeLessThan(100);

    const recs = openRecommendations(db, "frcrbank", summary.auditId);
    expect(recs.every((r) => r.isNew)).toBe(true);
    expect(recs.some((r) => r.category === "competitor-gap")).toBe(true);

    const audit = latestAudit(db, "frcrbank");
    expect(audit?.status).toBe("ok");
    expect(audit?.newRecCount).toBe(summary.recommendationsNew);
  });

  it("a second identical run surfaces no new to-dos", async () => {
    const db = createDb(":memory:");
    const site = upsertSite(db, {
      id: "frcrbank",
      domain: "https://frcrbank.com",
      competitors: [],
      keywords: [],
    });
    const first = await runSeoAudit(db, site, { crawl: fakeCrawl, reasonerClient: null });
    expect(first.recommendationsNew).toBeGreaterThan(0);
    const second = await runSeoAudit(db, site, { crawl: fakeCrawl, reasonerClient: null });
    expect(second.recommendationsNew).toBe(0);
    expect(second.recommendationsTotal).toBe(first.recommendationsTotal);
  });

  it("captures rank tracking from the SERP provider", async () => {
    const db = createDb(":memory:");
    const site = upsertSite(db, { id: "frcrbank", domain: "https://frcrbank.com", keywords: ["frcr"] });
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ url: "https://frcrbank.com/", title: "x" }] }), {
        headers: { "content-type": "application/json" },
      }),
    );
    await runSeoAudit(db, site, {
      crawl: fakeCrawl,
      reasonerClient: null,
      runResearch: async () => {
        throw new Error("no research in this test");
      },
      env: { SEO_SERP_URL: "http://localhost:8080" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const ranks = latestRankings(db, "frcrbank");
    expect(ranks).toHaveLength(1);
    expect(ranks[0]!.position).toBe(1);
  });

  it("records an error status when the crawl throws", async () => {
    const db = createDb(":memory:");
    const site = upsertSite(db, { id: "frcrbank", domain: "https://frcrbank.com" });
    const summary = await runSeoAudit(db, site, {
      crawl: async () => {
        throw new Error("network down");
      },
    });
    expect(summary.status).toBe("error");
    expect(latestAudit(db, "frcrbank")?.status).toBe("error");
  });
});
