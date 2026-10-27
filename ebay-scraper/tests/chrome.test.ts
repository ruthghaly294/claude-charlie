import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { startChrome } from "../src/chrome-process.js";
import { createChromeTransport } from "../src/chrome.js";
import { searchQuerySchema, completedQuerySchema } from "../src/query.js";
import { parseSearchHtml } from "../src/parser.js";

const html = readFileSync(
  new URL("./fixtures/search.html", import.meta.url),
  "utf8",
);
const query = searchQuerySchema.parse({
  query: "charizard",
  domain: "co.uk",
  page: "2",
  buying_format: "buy_it_now",
});
let browser: Browser;
let close: () => Promise<void>;
const requests: string[] = [];

beforeAll(async () => {
  const session = await startChrome({ headless: true });
  browser = session.browser;
  close = session.close;
  const context = browser.contexts()[0];
  if (!context) throw new Error("No browser context");
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "www.ebay.co.uk") return route.abort();
    requests.push(url.href);
    if (url.pathname === "/help/home")
      return route.fulfill({
        contentType: "text/html",
        body: '<a href="/" aria-label="eBay Startseite">eBay Startseite</a>',
      });
    if (url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: '<form action="/sch/i.html"><input id="gh-ac" name="_nkw"><button type="submit">Suchen</button></form>',
      });
    if (url.pathname === "/sch/i.html")
      if (url.searchParams.has("LH_Complete"))
        return route.fulfill({
          contentType: "text/html",
          body: '<script>location.replace("https://signin.ebay.co.uk/ws/eBayISAPI.dll?SignIn")</script>',
        });
    if (url.pathname === "/sch/i.html")
      return route.fulfill({
        contentType: "text/html",
        body:
          url.searchParams.get("_nkw") === "blocked"
            ? "<title>Error Page | eBay</title><div id=error-info>blocked</div>"
            : html,
      });
    return route.abort();
  });
}, 30000);

afterAll(async () => {
  if (close) await close();
});

describe("Chrome browser transport with intercepted offline pages", () => {
  it("opens search directly with a persistent signed-in profile", async () => {
    const before = requests.length;
    const transport = createChromeTransport({
      browser,
      profilePath: "/tmp/dedicated-test-profile",
    });
    const content = await transport.fetchHtml(query);
    expect(parseSearchHtml(content, query).results).toHaveLength(2);
    expect(new URL(requests[before]!).pathname).toBe("/sch/i.html");
    expect(
      requests
        .slice(before)
        .some((url) => new URL(url).pathname === "/help/home"),
    ).toBe(false);
    await transport.close();
  });
  it("recognizes the completed-listing sign-in redirect without visiting other origins", async () => {
    const transport = createChromeTransport({ browser, timeoutMs: 2000 });
    await expect(
      transport.fetchHtml(
        completedQuerySchema.parse({
          query: "chesterfield captain chairs",
          domain: "co.uk",
        }),
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_AUTH_REQUIRED",
      statusCode: 503,
    });
    expect(browser.contexts()[0]?.pages()).toHaveLength(1);
  });
  it("cancels promptly while Chrome connection initialization is stalled", async () => {
    let started: () => void = () => {};
    const accepted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const server = createServer(() => {
      started();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No local test endpoint");
    const transport = createChromeTransport({
      cdpEndpoint: `http://127.0.0.1:${address.port}`,
      timeoutMs: 2000,
    });
    const controller = new AbortController();
    try {
      const pending = transport.fetchHtml(query, controller.signal);
      await accepted;
      const before = Date.now();
      controller.abort();
      await expect(pending).rejects.toMatchObject({
        code: "REQUEST_CANCELLED",
      });
      expect(Date.now() - before).toBeLessThan(500);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await transport.close();
    }
  });
  it("uses a normal Chrome user agent in headless mode", async () => {
    const page = browser.contexts()[0]?.pages()[0];
    if (!page) throw new Error("No Chrome page");
    const metadata = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      webdriver: navigator.webdriver,
    }));
    expect(metadata.userAgent).toContain("Chrome/");
    expect(metadata.userAgent).not.toContain("HeadlessChrome");
    expect(metadata.webdriver).toBe(false);
  });
  it("rejects a missing Chrome executable without opening a browser", async () => {
    await expect(
      startChrome({ executablePath: "/missing-ebay-chrome-test-binary" }),
    ).rejects.toMatchObject({ code: "BROWSER_UNAVAILABLE" });
  });
  it("cancels an active operation and closes its tab", async () => {
    const controller = new AbortController();
    const transport = createChromeTransport({ browser });
    const pending = transport.fetchHtml(query, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(browser.contexts()[0]?.pages()).toHaveLength(1);
  });
  it("enforces the overall Chrome deadline", async () => {
    const transport = createChromeTransport({ browser, timeoutMs: 1 });
    await expect(transport.fetchHtml(query)).rejects.toMatchObject({
      code: "UPSTREAM_TIMEOUT",
      statusCode: 504,
    });
    expect(browser.contexts()[0]?.pages()).toHaveLength(1);
  });
  it("submits the native search form, applies filters and returns parseable HTML", async () => {
    const transport = createChromeTransport({ browser });
    const content = await transport.fetchHtml(query);
    expect(parseSearchHtml(content, query).results).toHaveLength(2);
    const requested = requests.map((url) => new URL(url));
    expect(
      requested.some(
        (url) =>
          url.pathname === "/sch/i.html" &&
          url.searchParams.get("LH_BIN") === "1" &&
          url.searchParams.get("_pgn") === "2",
      ),
    ).toBe(true);
    expect(browser.contexts()[0]?.pages()).toHaveLength(1);
    await transport.close();
    expect(browser.isConnected()).toBe(true);
  });
  it("preserves a block page for the normal parser to reject", async () => {
    const transport = createChromeTransport({ browser });
    const blocked = searchQuerySchema.parse({
      query: "blocked",
      domain: "co.uk",
    });
    const content = await transport.fetchHtml(blocked);
    expect(() => parseSearchHtml(content, blocked)).toThrow(/blocked/i);
  });
  it("enforces the rendered HTML size limit", async () => {
    const transport = createChromeTransport({ browser, maxBytes: 100 });
    await expect(transport.fetchHtml(query)).rejects.toMatchObject({
      code: "UPSTREAM_TOO_LARGE",
    });
  });
  it("does not create a tab for an already cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = createChromeTransport({ browser });
    await expect(
      transport.fetchHtml(query, controller.signal),
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(browser.contexts()[0]?.pages()).toHaveLength(1);
  });
  it("returns a sanitized error for an unavailable Chrome endpoint", async () => {
    const transport = createChromeTransport({
      cdpEndpoint: "http://127.0.0.1:1",
      timeoutMs: 100,
    });
    await expect(transport.fetchHtml(query)).rejects.toMatchObject({
      code: "BROWSER_UNAVAILABLE",
    });
    await transport.close();
  });
});
