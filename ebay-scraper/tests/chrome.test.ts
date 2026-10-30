import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
const recoveryAttempts = new Map<string, number>();

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
    if (url.pathname === "/itm/188151380610")
      return route.fulfill({
        status: 403,
        contentType: "text/html",
        body: "<title>Error Page | eBay</title><h1>Access Denied</h1>",
      });
    if (url.pathname === "/itm/188151380609")
      return route.fulfill({
        contentType: "text/html",
        body: '<title>Chair | eBay</title><script>{"listingId":"188151380609","startDate":{"value":"2026-10-30T09:00:00.000Z"}}</script>',
      });
    if (url.pathname === "/itm/188151380608") {
      const key = "detail-recovery";
      const attempt = recoveryAttempts.get(key) ?? 0;
      recoveryAttempts.set(key, attempt + 1);
      return route.fulfill({
        status: attempt === 0 ? 403 : 200,
        contentType: "text/html",
        body:
          attempt === 0
            ? '<title>Error Page | eBay</title><h1>SORRY</h1><div id="error-info">Something went wrong on our end</div>'
            : '<h1>Chair</h1><script>{"listingId":"188151380608","startDate":{"value":"2026-03-12T18:34:34.000Z"}}</script>',
      });
    }

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
    if (
      url.pathname === "/sch/i.html" &&
      url.searchParams.get("_nkw")?.startsWith("form-recovery")
    )
      return route.fulfill({
        status:
          url.searchParams.has("_pgn") &&
          !url.searchParams.get("_nkw")!.endsWith("persistent")
            ? 200
            : 403,
        contentType: "text/html",
        body:
          url.searchParams.has("_pgn") &&
          !url.searchParams.get("_nkw")!.endsWith("persistent")
            ? html
            : '<title>Error Page | eBay</title><h1>SORRY</h1><div id="error-info">Something went wrong on our end</div>',
      });
    if (
      url.pathname === "/sch/i.html" &&
      ["http403", "http429"].includes(url.searchParams.get("_nkw") ?? "")
    )
      return route.fulfill({
        status: Number(url.searchParams.get("_nkw")!.slice(4)),
        contentType: "text/html",
        body: "<title>Access Denied</title><h1>Access Denied</h1>",
      });
    if (
      url.pathname === "/sch/i.html" &&
      url.searchParams.get("_nkw")?.startsWith("recover")
    ) {
      const key = url.searchParams.get("_nkw")!;
      const attempt = (recoveryAttempts.get(key) ?? 0) + 1;
      recoveryAttempts.set(key, attempt);
      return route.fulfill({
        contentType: "text/html",
        body:
          key === "recover query" && attempt > 1
            ? html
            : '<title>Error Page | eBay</title><h1>SORRY</h1><div id="error-info">Something went wrong on our end. Please go back and try again.</div>',
      });
    }
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
            ? "<title>Pardon Our Interruption</title><form id=captcha_form>Security check</form>"
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
  it("enforces the deadline while tab creation is stalled", async () => {
    const context = browser.contexts()[0]!;
    const opening = vi
      .spyOn(context, "newPage")
      .mockImplementation(() => new Promise(() => {}));
    const transport = createChromeTransport({
      browser,
      timeoutMs: 50,
      profilePath: "/tmp/test-profile",
    });
    const before = Date.now();
    try {
      await expect(transport.fetchHtml(query)).rejects.toMatchObject({
        code: "UPSTREAM_TIMEOUT",
      });
      expect(Date.now() - before).toBeLessThan(1500);
    } finally {
      opening.mockRestore();
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
  it("waits for a slow cold start instead of failing at boot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slow-chrome-"));
    const slowChrome = join(dir, "chrome");
    const real = join(homedir(), ".cache/ebay-search/google-chrome/chrome");
    writeFileSync(
      slowChrome,
      `#!/bin/sh\n[ "$1" = "--version" ] || sleep 17\nexec "${real}" "$@"\n`,
      { mode: 0o755 },
    );
    try {
      const session = await startChrome({
        executablePath: slowChrome,
        headless: true,
      });
      await session.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
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

  it("recovers a generic eBay error once with one bounded retry and preserves every filter", async () => {
    const before = requests.length;
    const transport = createChromeTransport({
      browser,
      profilePath: "/tmp/test-profile",
    });
    const filtered = searchQuerySchema.parse({
      query: "recover query",
      domain: "co.uk",
      page: "2",
      sort_by: "newly_listed",
      condition: "used",
      min_price: "15",
      max_price: "400",
      free_shipping: "true",
      buying_format: "buy_it_now",
    });
    const content = await transport.fetchHtml(filtered);
    expect(parseSearchHtml(content, filtered).results).toHaveLength(2);
    const actual = requests.slice(before).map((url) => new URL(url));
    expect(actual).toHaveLength(2);
    expect(Object.fromEntries(actual[1]!.searchParams)).toMatchObject({
      _nkw: "recover query",
      _pgn: "2",
      _sop: "10",
      LH_ItemCondition: "3000",
      _udlo: "15",
      _udhi: "400",
      LH_FS: "1",
      LH_BIN: "1",
    });
  });
  it("stops after one recovery attempt when the generic error persists", async () => {
    const before = requests.length;
    const transport = createChromeTransport({
      browser,
      profilePath: "/tmp/test-profile",
    });
    const job = searchQuerySchema.parse({
      query: "recover-persistent",
      domain: "co.uk",
    });
    const content = await transport.fetchHtml(job);
    expect(() => parseSearchHtml(content, job)).toThrowError(
      expect.objectContaining({ code: "UPSTREAM_TEMPORARY_ERROR" }),
    );
    expect(requests.slice(before)).toHaveLength(2);
  });
  it("does not retry a genuine security challenge", async () => {
    const before = requests.length;
    const transport = createChromeTransport({
      browser,
      profilePath: "/tmp/test-profile",
    });
    const job = searchQuerySchema.parse({ query: "blocked", domain: "co.uk" });
    const content = await transport.fetchHtml(job);
    expect(() => parseSearchHtml(content, job)).toThrowError(
      expect.objectContaining({ code: "UPSTREAM_BLOCKED" }),
    );
    expect(requests.slice(before)).toHaveLength(1);
  });
  it.each([
    [403, "UPSTREAM_ACCESS_DENIED"],
    [429, "UPSTREAM_RATE_LIMITED"],
  ])(
    "reports HTTP %s separately and does not retry it immediately",
    async (status, code) => {
      const before = requests.length;
      const transport = createChromeTransport({
        browser,
        profilePath: "/tmp/test-profile",
      });
      await expect(
        transport.fetchHtml(
          searchQuerySchema.parse({ query: `http${status}`, domain: "co.uk" }),
        ),
      ).rejects.toMatchObject({ code, statusCode: 503 });
      expect(requests.slice(before)).toHaveLength(1);
    },
  );
  it("cancels during transient-error recovery and closes the tab", async () => {
    const context = browser.contexts()[0]!;
    const completed = context.waitForEvent("requestfinished", {
      predicate: (request) => request.url().includes("recover-cancel"),
    });
    const controller = new AbortController();
    const transport = createChromeTransport({
      browser,
      profilePath: "/tmp/test-profile",
    });
    const pending = transport.fetchHtml(
      searchQuerySchema.parse({ query: "recover-cancel", domain: "co.uk" }),
      controller.signal,
    );
    await completed;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(context.pages()).toHaveLength(1);
  });
  it("recovers a generic 403 with one paced form-compatible URL while preserving filters", async () => {
    const before = requests.length;
    const waits: number[] = [];
    const transport = createChromeTransport({
      browser,
      profilePath: "/tmp/test-profile",
      recoveryWait: async (ms) => {
        waits.push(ms);
      },
    });
    const filtered = searchQuerySchema.parse({
      query: "form-recovery chair",
      domain: "co.uk",
      sort_by: "newly_listed",
      condition: "used",
      max_price: "400",
      buying_format: "buy_it_now",
    });
    expect(
      parseSearchHtml(await transport.fetchHtml(filtered), filtered).results,
    ).toHaveLength(2);
    const actual = requests.slice(before).map((url) => new URL(url));
    expect(actual).toHaveLength(2);
    expect(Object.fromEntries(actual[1]!.searchParams)).toMatchObject({
      _nkw: "form-recovery chair",
      _pgn: "1",
      _sop: "10",
      LH_ItemCondition: "3000",
      _udhi: "400",
      LH_BIN: "1",
    });
    expect(waits).toEqual([20000]);
  });
  it("keeps a persistent generic refusal as an error after one compatibility attempt", async () => {
    const before = requests.length;
    const waits: number[] = [];
    const transport = createChromeTransport({
      browser,
      profilePath: "/tmp/test-profile",
      recoveryWait: async (ms) => {
        waits.push(ms);
      },
    });
    await expect(
      transport.fetchHtml(
        searchQuerySchema.parse({
          query: "form-recovery persistent",
          domain: "co.uk",
        }),
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_ACCESS_DENIED" });
    expect(requests.slice(before)).toHaveLength(2);
    expect(waits).toEqual([20000]);
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

it("recovers a temporary detail-page refusal once on the same item URL", async () => {
  const waits: number[] = [];
  const transport = createChromeTransport({
    browser,
    profilePath: "/tmp/detail-test",
    recoveryWait: async (ms) => {
      waits.push(ms);
    },
  });
  const content = await transport.fetchHtml(query, undefined, "188151380608");
  expect(content).toContain("2026-03-12T18:34:34.000Z");
  expect(recoveryAttempts.get("detail-recovery")).toBe(2);
  expect(waits).toEqual([20000]);
});

it("reads item metadata from the navigation response without waiting for rendered product elements", async () => {
  const transport = createChromeTransport({
    browser,
    profilePath: "/tmp/detail-response",
    timeoutMs: 2000,
  });
  expect(await transport.fetchHtml(query, undefined, "188151380609")).toContain(
    "2026-10-30T09:00:00.000Z",
  );
});

it("does not retry an explicit security refusal in a detail heading", async () => {
  const waits: number[] = [];
  const transport = createChromeTransport({
    browser,
    profilePath: "/tmp/detail-security",
    recoveryWait: async (ms) => {
      waits.push(ms);
    },
  });
  await expect(
    transport.fetchHtml(query, undefined, "188151380610"),
  ).rejects.toMatchObject({ code: "UPSTREAM_ACCESS_DENIED" });
  expect(waits).toEqual([]);
});

it("reads server-rendered search results even while a page widget prevents rendering from finishing", async () => {
  const context = browser.contexts()[0]!;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const widget = async (route: import("playwright-core").Route) => {
    await held;
    await route.fulfill({ body: "" }).catch(() => {});
  };
  const results = async (route: import("playwright-core").Route) => {
    if (
      new URL(route.request().url()).searchParams.get("_nkw") !==
      "server-response"
    )
      return route.fallback();
    return route.fulfill({
      contentType: "text/html",
      body:
        '<script src="https://www.ebay.co.uk/slow-widget.js"></script>' + html,
    });
  };
  await context.route("**/slow-widget.js", widget);
  await context.route("**/sch/i.html?*", results);
  try {
    const transport = createChromeTransport({
      browser,
      profilePath: "/tmp/ssr-test",
      timeoutMs: 2500,
    });
    const q = searchQuerySchema.parse({
      query: "server-response",
      domain: "co.uk",
    });
    expect(
      parseSearchHtml(await transport.fetchHtml(q), q).results,
    ).toHaveLength(2);
  } finally {
    release();
    await context.unroute("**/slow-widget.js", widget);
    await context.unroute("**/sch/i.html?*", results);
  }
});
