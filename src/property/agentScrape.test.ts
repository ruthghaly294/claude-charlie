import { describe, it, expect, vi } from "vitest";
import { createDb } from "@/db/client";
import { listings, geocodeCache } from "@/db/schema";
import {
  extractListing,
  scrapeAgent,
  scrapeAllAgents,
  type AgentConfig,
} from "./agentScrape";
import type { ExtractClient } from "./llmExtract";

const TR_PAGE = `<html><head>
<meta property="og:title" content=" 11 Fairway Gardens, Upper Malone Road, Belfast Property for sale at Templeton Robinson" />
</head><body>
<div class="dcell dprice"><span>Price</span><span>Offers Over</span><span>&pound;475,000</span></div>
<ul><li>4 Bedroom</li><li>2 Reception</li></ul>
<p>Stamp duty £11,250</p>
</body></html>`;

describe("extractListing", () => {
  it("pulls price, address, area and beds from an agent page", () => {
    const l = extractListing(
      TR_PAGE,
      "https://www.templetonrobinson.com/property/malone/trltrl67246/11-fairway-gardens/",
      "templeton-robinson",
    );
    expect(l).not.toBeNull();
    expect(l!.askingPrice).toBe(475000); // not the £11,250 stamp duty
    expect(l!.area).toBe("south-belfast"); // "malone" slug
    // fuller address from og:title (better for geocoding) — suffix stripped
    expect(l!.address).toBe("11 Fairway Gardens, Upper Malone Road, Belfast");
    expect(l!.beds).toBe(4);
  });

  it("returns null when there is no price", () => {
    expect(
      extractListing("<html><body>POA</body></html>", "https://x/property/a/b/c", "x"),
    ).toBeNull();
  });

  it("skips lettings (for rent / to let)", () => {
    const rent = `<html><head>
<meta property="og:title" content="30 Shaw Street, Belmont, Belfast, BT4 1PT for rent with John Minnis" />
</head><body><div class="price-amount">&pound;895pm</div></body></html>`;
    expect(
      extractListing(rent, "https://x/property/belmont/id/30-shaw-street/", "jm"),
    ).toBeNull();
  });
});

const SITEMAP = `<urlset>
  <url><loc>https://www.templetonrobinson.com/property/malone/id1/11-fairway-gardens/</loc></url>
  <url><loc>https://www.templetonrobinson.com/property/stormont/id2/3-massey-avenue/</loc></url>
  <url><loc>https://www.templetonrobinson.com/property/portrush/id3/9-seaside/</loc></url>
  <url><loc>https://www.templetonrobinson.com/article/market-update</loc></url>
</urlset>`;

describe("scrapeAgent", () => {
  it("filters the sitemap to tracked-area listings and extracts each", async () => {
    const agent: AgentConfig = {
      key: "templeton-robinson",
      name: "Templeton Robinson",
      sitemapUrl: "https://tr/sitemap",
      include: ["/property/[^/]+/[^/]+/[^/]+/?$"],
      enabled: true,
    };
    const fetchImpl = vi.fn((url: unknown) => {
      const u = String(url);
      const body = u.includes("/sitemap")
        ? SITEMAP
        : TR_PAGE.replace("malone", u.includes("stormont") ? "stormont" : "malone");
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as unknown as typeof fetch;

    const out = await scrapeAgent(agent, {
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    // malone (south) + stormont (east) kept; portrush + article dropped
    expect(out).toHaveLength(2);
    expect(out.map((l) => l.area).sort()).toEqual(["east-belfast", "south-belfast"]);
  });
});

describe("scrapeAgent with robots.txt", () => {
  it("skips listing URLs disallowed by robots.txt", async () => {
    const agent: AgentConfig = {
      key: "templeton-robinson",
      name: "Templeton Robinson",
      sitemapUrl: "https://tr2/sitemap",
      include: ["/property/[^/]+/[^/]+/[^/]+/?$"],
      enabled: true,
    };
    const SITEMAP2 = `<urlset>
  <url><loc>https://tr2/property/malone/id1/11-fairway-gardens/</loc></url>
  <url><loc>https://tr2/property/stormont/id2/3-massey-avenue/</loc></url>
</urlset>`;
    const fetchImpl = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/robots.txt")) {
        return Promise.resolve(
          new Response("User-agent: *\nDisallow: /property/stormont/", { status: 200 }),
        );
      }
      if (u.includes("/sitemap")) {
        return Promise.resolve(new Response(SITEMAP2, { status: 200 }));
      }
      const body = TR_PAGE.replace("malone", u.includes("stormont") ? "stormont" : "malone");
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as unknown as typeof fetch;

    const out = await scrapeAgent(agent, {
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    // stormont listing is disallowed by robots.txt; only malone remains
    expect(out).toHaveLength(1);
    expect(out[0]!.area).toBe("south-belfast");
  });
});

describe("scrapeAgent with LLM repair", () => {
  it("fills missing postcode/sizeSqm via repairExtractionCached", async () => {
    const db = createDb(":memory:");
    const agent: AgentConfig = {
      key: "templeton-robinson",
      name: "Templeton Robinson",
      sitemapUrl: "https://tr3/sitemap",
      include: ["/property/[^/]+/[^/]+/[^/]+/?$"],
      enabled: true,
    };
    const SITEMAP3 = `<urlset>
  <url><loc>https://tr3/property/malone/id1/11-fairway-gardens/</loc></url>
</urlset>`;
    const fetchImpl = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/robots.txt")) {
        return Promise.resolve(new Response("", { status: 404 }));
      }
      if (u.includes("/sitemap")) {
        return Promise.resolve(new Response(SITEMAP3, { status: 200 }));
      }
      return Promise.resolve(new Response(TR_PAGE, { status: 200 }));
    }) as unknown as typeof fetch;

    const parse = vi.fn(async () => ({
      parsed_output: { postcode: "BT9 6AB", sizeSqm: 120 },
    }));
    const extractClient: ExtractClient = { messages: { parse } };

    const out = await scrapeAgent(agent, {
      fetchImpl,
      sleep: () => Promise.resolve(),
      db,
      extractClient,
    });

    expect(out).toHaveLength(1);
    expect(out[0]!.postcode).toBe("BT9 6AB");
    expect(out[0]!.sizeSqm).toBe(120);
    expect(parse).toHaveBeenCalledTimes(1);
  });
});

describe("scrapeAgent with extraction config", () => {
  it("skips LLM repair when llmRepair is false", async () => {
    const db = createDb(":memory:");
    const agent: AgentConfig = {
      key: "templeton-robinson",
      name: "Templeton Robinson",
      sitemapUrl: "https://tr4/sitemap",
      include: ["/property/[^/]+/[^/]+/[^/]+/?$"],
      enabled: true,
    };
    const SITEMAP4 = `<urlset>
  <url><loc>https://tr4/property/malone/id1/11-fairway-gardens/</loc></url>
</urlset>`;
    const fetchImpl = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/robots.txt")) return Promise.resolve(new Response("", { status: 404 }));
      if (u.includes("/sitemap")) return Promise.resolve(new Response(SITEMAP4, { status: 200 }));
      return Promise.resolve(new Response(TR_PAGE, { status: 200 }));
    }) as unknown as typeof fetch;

    const parse = vi.fn(async () => ({
      parsed_output: { postcode: "BT9 6AB", sizeSqm: 120 },
    }));
    const extractClient: ExtractClient = { messages: { parse } };

    const out = await scrapeAgent(agent, {
      fetchImpl,
      sleep: () => Promise.resolve(),
      db,
      extractClient,
      llmRepair: false,
    });

    expect(out).toHaveLength(1);
    expect(out[0]!.postcode).toBeFalsy();
    expect(parse).not.toHaveBeenCalled();
  });

  it("caps LLM repair calls at llmMaxPagesPerRun", async () => {
    const db = createDb(":memory:");
    const agent: AgentConfig = {
      key: "templeton-robinson",
      name: "Templeton Robinson",
      sitemapUrl: "https://tr5/sitemap",
      include: ["/property/[^/]+/[^/]+/[^/]+/?$"],
      enabled: true,
    };
    const SITEMAP5 = `<urlset>
  <url><loc>https://tr5/property/malone/id1/11-fairway-gardens/</loc></url>
  <url><loc>https://tr5/property/stormont/id2/3-massey-avenue/</loc></url>
</urlset>`;
    const fetchImpl = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/robots.txt")) return Promise.resolve(new Response("", { status: 404 }));
      if (u.includes("/sitemap")) return Promise.resolve(new Response(SITEMAP5, { status: 200 }));
      // distinct bodies so the extraction cache doesn't mask the per-run cap
      const body = TR_PAGE.replace("</body>", `<!-- ${u} --></body>`);
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as unknown as typeof fetch;

    const parse = vi.fn(async () => ({
      parsed_output: { postcode: "BT9 6AB", sizeSqm: 120 },
    }));
    const extractClient: ExtractClient = { messages: { parse } };

    const out = await scrapeAgent(agent, {
      fetchImpl,
      sleep: () => Promise.resolve(),
      db,
      extractClient,
      llmMaxPagesPerRun: 1,
    });

    expect(out).toHaveLength(2);
    expect(parse).toHaveBeenCalledTimes(1);
  });
});

describe("scrapeAllAgents with geocoding", () => {
  it("geocodes scraped listings to a postcode and stores coords", async () => {
    const db = createDb(":memory:");
    const agent: AgentConfig = {
      key: "templeton-robinson",
      name: "Templeton Robinson",
      sitemapUrl: "https://tr/sitemap",
      include: ["/property/[^/]+/[^/]+/[^/]+/?$"],
      enabled: true,
    };
    const fetchImpl = vi.fn((url: unknown) => {
      const u = String(url);
      let body = "";
      if (u.includes("/sitemap")) {
        body = `<urlset><url><loc>https://tr/property/malone/id1/11-fairway-gardens/</loc></url></urlset>`;
      } else if (u.includes("nominatim")) {
        body = JSON.stringify([
          { lat: "54.58", lon: "-5.93", address: { postcode: "BT9 6AB" } },
        ]);
      } else {
        body = TR_PAGE;
      }
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as unknown as typeof fetch;

    const [summary] = await scrapeAllAgents(db, {
      agents: [agent],
      fetchImpl,
      sleep: () => Promise.resolve(),
      geocodeDelayMs: 0,
    });
    expect(summary!.geocoded).toBe(1);
    const row = db.select().from(listings).get();
    expect(row?.postcode).toBe("BT9 6AB");
    expect(row?.latitude).toBe(54.58);
    expect(db.select().from(geocodeCache).all()).toHaveLength(1);
    expect(summary!.listingIds).toEqual([row!.id]);
  });

  it("passes geocodeProviders through to geocodeWithCache", async () => {
    const db = createDb(":memory:");
    const agent: AgentConfig = {
      key: "templeton-robinson",
      name: "Templeton Robinson",
      sitemapUrl: "https://tr/sitemap",
      include: ["/property/[^/]+/[^/]+/[^/]+/?$"],
      enabled: true,
    };
    const fetchImpl = vi.fn((url: unknown) => {
      const u = String(url);
      let body = "";
      if (u.includes("/sitemap")) {
        body = `<urlset><url><loc>https://tr/property/malone/id1/11-fairway-gardens/</loc></url></urlset>`;
      } else if (u.includes("nominatim")) {
        body = JSON.stringify([
          { lat: "54.58", lon: "-5.93", address: { postcode: "BT9 6AB" } },
        ]);
      } else {
        body = TR_PAGE;
      }
      return Promise.resolve(new Response(body, { status: 200 }));
    });

    await scrapeAllAgents(db, {
      agents: [agent],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      geocodeDelayMs: 0,
      geocodeProviders: ["postcode-centroid"],
    });
    expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes("nominatim"))).toBe(false);
  });
});
