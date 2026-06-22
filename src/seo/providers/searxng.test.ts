import { describe, it, expect, vi } from "vitest";
import { rankingFromResults, searxngProvider } from "./searxng";
import { gatherProviderSignals, providerStatuses } from "./index";
import type { SeoSite } from "@/db/schema";

function site(over: Partial<SeoSite> = {}): SeoSite {
  return {
    id: "s1",
    label: "S",
    domain: "https://frcrbank.com",
    competitors: ["https://radiologycafe.com"],
    keywords: ["frcr part 1"],
    maxPages: 40,
    createdAt: "2026-01-01",
    ...over,
  };
}

describe("rankingFromResults", () => {
  it("finds our position and competitors ahead of us", () => {
    const r = rankingFromResults(
      "frcr part 1",
      [
        "https://radiologycafe.com/frcr",
        "https://wikipedia.org/x",
        "https://www.frcrbank.com/part-1",
      ],
      "https://frcrbank.com",
      ["https://radiologycafe.com"],
    );
    expect(r.position).toBe(3);
    expect(r.competitorsAhead).toEqual(["radiologycafe.com"]);
    expect(r.url).toBe("https://www.frcrbank.com/part-1");
  });

  it("reports null position when we don't appear", () => {
    const r = rankingFromResults("x", ["https://other.com/a"], "https://frcrbank.com", []);
    expect(r.position).toBeNull();
  });
});

describe("searxngProvider", () => {
  it("is unconfigured without SEO_SERP_URL", () => {
    expect(searxngProvider.state({ env: {} }).configured).toBe(false);
  });

  it("queries SearXNG and returns rankings when configured", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ results: [{ url: "https://frcrbank.com/p", title: "FRCR" }] }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const ctx = {
      env: { SEO_SERP_URL: "http://localhost:8080" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    };
    expect(searxngProvider.state(ctx).configured).toBe(true);
    const signals = await searxngProvider.fetch(site(), ctx);
    expect(signals.rankings).toHaveLength(1);
    expect(signals.rankings[0]!.position).toBe(1);
    expect(signals.notes[0]).toContain('Ranks #1 for "frcr part 1"');
  });
});

describe("provider registry", () => {
  it("reports configured/skipped status per provider", () => {
    const statuses = providerStatuses({ env: {} });
    expect(statuses.find((s) => s.key === "searxng")?.configured).toBe(false);
    expect(statuses.find((s) => s.key === "google-search-console")).toBeDefined();
  });

  it("gathers only from configured providers and isolates failures", async () => {
    const signals = await gatherProviderSignals(site(), { env: {} });
    expect(signals).toEqual({ rankings: [], notes: [] });
  });
});
