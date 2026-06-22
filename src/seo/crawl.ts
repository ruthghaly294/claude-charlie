import { fetchText, fetchWithRetry, type FetchRetryOptions } from "@/discovery/fetchWithRetry";
import type { CrawlResult, PageMetrics, SiteSignals } from "./types";

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const META_DESC_RE =
  /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i;
const META_DESC_RE2 =
  /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i;
const CANONICAL_RE =
  /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)["']/i;
const OG_TITLE_RE =
  /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i;
const VIEWPORT_RE = /<meta[^>]+name=["']viewport["']/i;
const H1_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
const HEADING_RE = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
const IMG_RE = /<img\b[^>]*>/gi;
const ALT_RE = /\balt\s*=\s*["'][^"']*\S[^"']*["']/i;
const HREF_RE = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
const JSONLD_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Default polite crawl headers — identify ourselves like the property scraper. */
const UA = "DecodeSEOBot/1.0 (+https://github.com/decode-os)";

const AI_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "Claude-Web",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
  "anthropic-ai",
];

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function flatten(node: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const n of node) flatten(n, out);
    return out;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj["@graph"])) flatten(obj["@graph"], out);
    out.push(obj);
  }
  return out;
}

/** The schema.org @type values present in a page's JSON-LD blocks. */
export function jsonLdTypes(html: string): string[] {
  const types = new Set<string>();
  for (const m of html.matchAll(JSONLD_RE)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]!.trim());
    } catch {
      continue;
    }
    for (const node of flatten(parsed)) {
      const t = (node as Record<string, unknown>)["@type"];
      if (typeof t === "string") types.add(t);
      else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") types.add(x);
    }
  }
  return [...types];
}

function sameHost(href: string, base: string): boolean | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.host === new URL(base).host;
  } catch {
    return null;
  }
}

/** Parse a single HTML document into structured SEO metrics. Pure + testable. */
export function parsePage(html: string, url: string, status = 200): PageMetrics {
  const title = decodeEntities(TITLE_RE.exec(html)?.[1] ?? "");
  const metaDescription = decodeEntities(
    META_DESC_RE.exec(html)?.[1] ?? META_DESC_RE2.exec(html)?.[1] ?? "",
  );
  const canonical = CANONICAL_RE.exec(html)?.[1]?.trim() ?? "";
  const ogTitle = decodeEntities(OG_TITLE_RE.exec(html)?.[1] ?? "");

  const h1s = [...html.matchAll(H1_RE)].map((m) => decodeEntities(m[1]!)).filter(Boolean);
  const headings = [...html.matchAll(HEADING_RE)].map((m) => decodeEntities(m[2]!)).filter(Boolean);

  const imgs = [...html.matchAll(IMG_RE)].map((m) => m[0]!);
  const imagesWithAlt = imgs.filter((tag) => ALT_RE.test(tag)).length;

  let internalLinks = 0;
  let externalLinks = 0;
  for (const m of html.matchAll(HREF_RE)) {
    const same = sameHost(m[1]!, url);
    if (same === true) internalLinks++;
    else if (same === false) externalLinks++;
  }

  const text = stripTags(html);
  const wordCount = text ? text.split(/\s+/).length : 0;

  return {
    url,
    status,
    title,
    metaDescription,
    canonical,
    ogTitle,
    h1s,
    headings,
    jsonLdTypes: jsonLdTypes(html),
    wordCount,
    imagesTotal: imgs.length,
    imagesWithAlt,
    internalLinks,
    externalLinks,
    hasViewportMeta: VIEWPORT_RE.test(html),
    text,
  };
}

/** Pull <loc> URLs from a sitemap.xml (ignores nested sitemap indexes' detail). */
export function parseSitemap(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);
}

/** AI-crawler user-agents that a robots.txt body explicitly disallows from "/". */
export function blockedAiBots(robotsTxt: string): string[] {
  const blocked: string[] = [];
  const blocks = robotsTxt.split(/\n(?=\s*user-agent:)/i);
  for (const bot of AI_BOTS) {
    const block = blocks.find((b) =>
      new RegExp(`user-agent:\\s*${bot}\\b`, "i").test(b),
    );
    if (block && /\n\s*disallow:\s*\/\s*(\n|$)/i.test(block)) blocked.push(bot);
  }
  return blocked;
}

async function tryFetchText(
  url: string,
  fetchOpts: FetchRetryOptions,
): Promise<string | null> {
  try {
    return await fetchText(url, { headers: { "user-agent": UA } }, fetchOpts);
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type CrawlOptions = {
  maxPages?: number;
  fetchImpl?: typeof fetch;
  /** politeness delay between page fetches (ms); 0 in tests */
  delayMs?: number;
  signal?: AbortSignal;
};

function originOf(domain: string): string {
  const withProto = /^https?:\/\//.test(domain) ? domain : `https://${domain}`;
  return new URL(withProto).origin;
}

/**
 * Crawl a site: read robots.txt / sitemap.xml / llms.txt for site signals, then
 * fetch up to `maxPages` URLs (sitemap first, else homepage + same-host links)
 * and parse each. Reuses fetchWithRetry for resilience and stays polite.
 */
export async function crawlSite(
  domain: string,
  opts: CrawlOptions = {},
): Promise<CrawlResult> {
  const origin = originOf(domain);
  const maxPages = opts.maxPages ?? 40;
  const delayMs = opts.delayMs ?? 300;
  const fetchOpts: FetchRetryOptions = {
    fetchImpl: opts.fetchImpl,
    signal: opts.signal,
    retries: 2,
  };

  const robotsTxt = (await tryFetchText(`${origin}/robots.txt`, fetchOpts)) ?? "";
  const sitemapXml = await tryFetchText(`${origin}/sitemap.xml`, fetchOpts);
  const llmsTxt = await tryFetchText(`${origin}/llms.txt`, fetchOpts);

  const signals: SiteSignals = {
    hasRobotsTxt: robotsTxt.length > 0,
    hasSitemap: sitemapXml !== null && /<loc>/i.test(sitemapXml),
    hasLlmsTxt: llmsTxt !== null,
    blockedAiBots: blockedAiBots(robotsTxt),
    robotsTxt,
  };

  let urls: string[] = [];
  if (sitemapXml) {
    urls = parseSitemap(sitemapXml)
      .filter((u) => sameHost(u, origin) === true)
      .slice(0, maxPages);
  }
  const fromSitemap = urls.length > 0;
  if (urls.length === 0) urls = [origin + "/"];

  const pages: PageMetrics[] = [];
  for (let i = 0; i < urls.length && pages.length < maxPages; i++) {
    const url = urls[i]!;
    try {
      const res = await fetchWithRetry(
        url,
        { headers: { "user-agent": UA } },
        fetchOpts,
      );
      const html = await res.text();
      const page = parsePage(html, url, res.status);

      if (!fromSitemap && i === 0 && page.internalLinks > 0) {
        const discovered = discoverLinks(html, origin).slice(0, maxPages - 1);
        urls.push(...discovered);
      }
      pages.push(page);
    } catch {
      pages.push({
        url,
        status: 0,
        title: "",
        metaDescription: "",
        canonical: "",
        ogTitle: "",
        h1s: [],
        headings: [],
        jsonLdTypes: [],
        wordCount: 0,
        imagesTotal: 0,
        imagesWithAlt: 0,
        internalLinks: 0,
        externalLinks: 0,
        hasViewportMeta: false,
        text: "",
      });
    }
    if (i < urls.length - 1 && delayMs > 0) await sleep(delayMs);
  }

  return { domain: origin, pages, signals };
}

function discoverLinks(html: string, origin: string): string[] {
  const seen = new Set<string>();
  for (const m of html.matchAll(HREF_RE)) {
    try {
      const u = new URL(m[1]!, origin);
      if (u.host !== new URL(origin).host) continue;
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      u.hash = "";
      const clean = u.toString();
      if (clean !== origin + "/") seen.add(clean);
    } catch {
      continue;
    }
  }
  return [...seen];
}
