import { describe, it, expect, vi } from "vitest";
import { blockedAiBots, crawlSite, jsonLdTypes, parsePage, parseSitemap } from "./crawl";

const HTML = `<!doctype html><html><head>
<title>FRCR Part 1 Question Bank</title>
<meta name="description" content="Practice questions for the FRCR Part 1 physics and anatomy exam with detailed explanations and analytics.">
<link rel="canonical" href="https://frcrbank.com/">
<meta property="og:title" content="FRCR Bank">
<meta name="viewport" content="width=device-width">
<script type="application/ld+json">{"@type":"FAQPage","mainEntity":[]}</script>
</head><body>
<h1>FRCR Part 1 Prep</h1>
<h2>What is included?</h2>
<img src="a.png" alt="diagram"><img src="b.png">
<a href="/pricing">Pricing</a><a href="https://twitter.com/x">Twitter</a>
<p>${"word ".repeat(400)}</p>
</body></html>`;

describe("parsePage", () => {
  it("extracts core SEO metrics from a document", () => {
    const p = parsePage(HTML, "https://frcrbank.com/");
    expect(p.title).toBe("FRCR Part 1 Question Bank");
    expect(p.metaDescription).toContain("Practice questions");
    expect(p.canonical).toBe("https://frcrbank.com/");
    expect(p.ogTitle).toBe("FRCR Bank");
    expect(p.h1s).toEqual(["FRCR Part 1 Prep"]);
    expect(p.headings).toContain("What is included?");
    expect(p.hasViewportMeta).toBe(true);
    expect(p.imagesTotal).toBe(2);
    expect(p.imagesWithAlt).toBe(1);
    expect(p.internalLinks).toBe(1);
    expect(p.externalLinks).toBe(1);
    expect(p.wordCount).toBeGreaterThan(300);
    expect(p.jsonLdTypes).toEqual(["FAQPage"]);
  });
});

describe("jsonLdTypes", () => {
  it("flattens @graph and array @type values", () => {
    const html = `<script type="application/ld+json">
      {"@graph":[{"@type":"Organization"},{"@type":["Article","NewsArticle"]}]}
    </script>`;
    expect(jsonLdTypes(html).sort()).toEqual(["Article", "NewsArticle", "Organization"]);
  });
});

describe("parseSitemap", () => {
  it("pulls loc URLs", () => {
    const xml = `<urlset><url><loc>https://x.com/a</loc></url><url><loc>https://x.com/b</loc></url></urlset>`;
    expect(parseSitemap(xml)).toEqual(["https://x.com/a", "https://x.com/b"]);
  });
});

describe("blockedAiBots", () => {
  it("detects AI crawlers disallowed from root", () => {
    const robots = `User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /`;
    expect(blockedAiBots(robots)).toContain("GPTBot");
  });
  it("does not flag bots that are allowed", () => {
    const robots = `User-agent: *\nAllow: /`;
    expect(blockedAiBots(robots)).toEqual([]);
  });
});

describe("crawlSite", () => {
  it("reads site signals and crawls sitemap URLs", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /");
      if (url.endsWith("/sitemap.xml"))
        return new Response("<urlset><url><loc>https://frcrbank.com/</loc></url></urlset>");
      if (url.endsWith("/llms.txt")) return new Response("", { status: 404 });
      return new Response(HTML, { status: 200 });
    });

    const result = await crawlSite("https://frcrbank.com", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      delayMs: 0,
      maxPages: 5,
    });

    expect(result.signals.hasRobotsTxt).toBe(true);
    expect(result.signals.hasSitemap).toBe(true);
    expect(result.signals.hasLlmsTxt).toBe(false);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.title).toBe("FRCR Part 1 Question Bank");
  });
});
