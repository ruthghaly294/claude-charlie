import { describe, it, expect, vi } from "vitest";
import { createDb } from "@/db/client";
import { listings, postcodeValues, geocodeCache } from "@/db/schema";
import {
  extractListing,
  scrapeAgent,
  scrapeAllAgents,
  type AgentConfig,
} from "./agentScrape";

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
      listingRe: /\/property\/[^/]+\/[^/]+\/[^/]+\/?$/i,
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

describe("scrapeAllAgents with geocoding", () => {
  it("geocodes scraped listings to a postcode and stores coords", async () => {
    const db = createDb(":memory:");
    const agent: AgentConfig = {
      key: "templeton-robinson",
      name: "Templeton Robinson",
      sitemapUrl: "https://tr/sitemap",
      listingRe: /\/property\/[^/]+\/[^/]+\/[^/]+\/?$/i,
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
  });
});
