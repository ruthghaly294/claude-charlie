import { load } from "cheerio";
import { parseSearchHtml } from "./parser.js";
import { importEbaySession } from "./session-import.js";
import type { Browser, Page, Frame } from "playwright-core";
import { startChrome, type ChromeSession } from "./chrome-process.js";
import { ScrapeError, ebaySignInRequired } from "./errors.js";
import { buildSearchUrl, markets, type SearchQuery } from "./query.js";
import type { HtmlFetcher } from "./transport.js";

type Options = {
  readonly browser?: Browser;
  readonly cdpEndpoint?: string;
  readonly executablePath?: string;
  readonly headless?: boolean;
  readonly profilePath?: string;
  readonly sessionImportFile?: string;
  readonly proxyUrl?: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly recoveryWait?: (ms: number) => Promise<void>;
};

async function closeWithin(
  close: () => Promise<void>,
  ms: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      close().catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function search(
  page: Page,
  query: SearchQuery,
  timeoutMs: number,
  persistentProfile: boolean,
  itemId?: string,
  wait: (ms: number) => Promise<void> = (ms) => page.waitForTimeout(ms),
): Promise<string> {
  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(timeoutMs);
  const origin = `https://www.ebay.${query.domain}`;
  let authenticationRequired = false;
  const isSignIn = (url: URL): boolean =>
    url.protocol === "https:" &&
    Object.keys(markets).some(
      (market) => url.hostname === `signin.ebay.${market}`,
    );
  const onNavigation = (frame: Frame): void => {
    if (frame !== page.mainFrame()) return;
    const destination = new URL(frame.url());
    if (
      !/^https?:$/.test(destination.protocol) ||
      destination.origin === origin
    )
      return;
    authenticationRequired ||= isSignIn(destination);
    void page.close().catch(() => {});
  };
  page.on("framenavigated", onNavigation);
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (["image", "media", "font"].includes(request.resourceType()))
      return route.abort();
    if (
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame() &&
      new URL(request.url()).origin !== origin
    ) {
      const destination = new URL(request.url());
      authenticationRequired ||= isSignIn(destination);
      await route.abort();
      void page.close().catch(() => {});
      return;
    }
    return route.fallback();
  });
  try {
    if (!persistentProfile && !itemId) {
      await page.goto(`${origin}/help/home`, { waitUntil: "domcontentloaded" });
      await Promise.all([
        page.waitForURL(
          (url) => url.origin === origin && url.pathname === "/",
          {
            waitUntil: "domcontentloaded",
          },
        ),
        page
          .locator(`a[href="/"], a[href="${origin}"], a[href="${origin}/"]`)
          .first()
          .click(),
      ]);
      await page.locator("#gh-ac").fill(query.query);
      await Promise.all([
        page.waitForURL(
          (url) => url.origin === origin && url.pathname === "/sch/i.html",
          { waitUntil: "domcontentloaded" },
        ),
        page
          .locator(
            'form[action*="/sch/"] button[type="submit"], #gh-search-btn, #gh-btn',
          )
          .first()
          .click(),
      ]);
      const first = await page.content();
      if (/pardon our interruption|access denied/i.test(await page.title()))
        return first;
    }
    let target = itemId
      ? `${origin}/itm/${itemId}`
      : buildSearchUrl(query).href;
    let status = 200;
    let securityChallenge = false;
    const navigate = async (): Promise<string> => {
      const response = await page.goto(target, { waitUntil: "commit" });
      status = response?.status() ?? 200;
      if (status === 429)
        throw new ScrapeError(
          "UPSTREAM_RATE_LIMITED",
          "eBay rate-limited the request (HTTP 429).",
          503,
        );
      if (status >= 500)
        throw new ScrapeError(
          "UPSTREAM_TEMPORARY_ERROR",
          `eBay returned a temporary HTTP ${status} error.`,
          503,
        );
      // Listing start metadata is in the server response. Reading that body
      // avoids waiting for product widgets or advertising scripts to render.
      if (response) {
        const body = await response.text();
        if (itemId) return body;
        try {
          parseSearchHtml(body, query);
          return body;
        } catch (error) {
          if (
            error instanceof ScrapeError &&
            error.code !== "UPSTREAM_MARKUP_CHANGED"
          ) {
            securityChallenge = error.code === "UPSTREAM_BLOCKED";
            return body;
          }
          // Recognize a dedicated sign-in redirect before waiting for scripts
          // to run; a blocked renderer must not misclassify it as a timeout.
          const document = load(body);
          for (const script of document("script").toArray()) {
            const destination =
              /^\s*(?:window\.)?location\.(?:replace|assign)\(\s*["']([^"']+)["']\s*\)/.exec(
                document(script).text(),
              )?.[1];
            if (destination) {
              try {
                if (isSignIn(new URL(destination))) throw ebaySignInRequired();
              } catch (error) {
                if (error instanceof ScrapeError) throw error;
              }
            }
          }
        }
      }
      // Deferred advertising scripts can hold DOMContentLoaded after the
      // server-rendered results have been parsed.
      await page.waitForFunction(() => document.readyState !== "loading");
      if (status === 403) return page.content();
      await page
        .locator(
          itemId
            ? "h1, #error-info, #captcha_form"
            : ".srp-results, .srp-controls__count-heading, #error-info, #captcha_form",
        )
        .first()
        .waitFor({ state: "attached" });
      return page.content();
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const content = await navigate();
        const title = /<title[^>]*>([^<]*)<\/title>/i.exec(content)?.[1] ?? "";
        const challenge =
          securityChallenge ||
          /access denied|pardon our interruption|security measure|robot check|captcha/i.test(
            title + " " + (/<h1\b[^>]*>([^<]*)/i.exec(content)?.[1] ?? ""),
          ) ||
          /<form[^>]+(?:id=["']?captcha_form|action=["'][^"']*splashui)/i.test(
            content,
          );
        if (status === 403) {
          const alternative = itemId
            ? target
            : buildSearchUrl(query, query.completed ? "canonical" : "form")
                .href;
          if (
            challenge ||
            attempt === 1 ||
            (!itemId && alternative === target) ||
            !/error page \| ebay/i.test(title)
          )
            throw new ScrapeError(
              "UPSTREAM_ACCESS_DENIED",
              "eBay refused the request (HTTP 403); its reason was not disclosed.",
              503,
            );
          // Retry an item's temporary generic error at the same URL. Search
          // formats below represent the same public search and filters. The live
          // site can reject one representation while serving the other. Allow
          // one compatibility attempt, paced like a new scheduled search.
          target = alternative;
          await wait(20000);
          continue;
        }
        if (challenge || attempt === 1 || !/error page \| ebay/i.test(title))
          return content;
      } catch (error) {
        if (
          attempt === 1 ||
          !(error instanceof ScrapeError) ||
          error.code !== "UPSTREAM_TEMPORARY_ERROR"
        )
          throw error;
      }
      // One bounded retry for transient server failures, under the same overall
      // deadline. Explicit security challenges and rate limits do not loop.
      await wait(1000);
    }
    throw new ScrapeError(
      "UPSTREAM_TEMPORARY_ERROR",
      "eBay search could not recover.",
      503,
    );
  } catch (error) {
    if (authenticationRequired) throw ebaySignInRequired();
    throw error;
  } finally {
    page.removeListener("framenavigated", onNavigation);
  }
}

export function createChromeTransport(options: Options = {}): {
  readonly fetchHtml: HtmlFetcher;
  readonly close: () => Promise<void>;
} {
  const timeoutMs = options.timeoutMs ?? 45000;
  const maxBytes = options.maxBytes ?? 12 * 1024 * 1024;
  let connection: Promise<ChromeSession> | undefined;
  const connect = async (): Promise<ChromeSession> => {
    if (options.browser)
      return { browser: options.browser, close: async () => {} };
    if (options.cdpEndpoint) {
      const { chromium } = await import("playwright-core");
      const browser = await chromium.connectOverCDP(options.cdpEndpoint, {
        timeout: timeoutMs,
      });
      return { browser, close: () => browser.close() };
    }
    const session = await startChrome({
      ...(options.profilePath ? { profilePath: options.profilePath } : {}),
      ...(options.executablePath
        ? { executablePath: options.executablePath }
        : {}),
      ...(options.headless !== undefined ? { headless: options.headless } : {}),
      ...(options.proxyUrl ? { proxyUrl: options.proxyUrl } : {}),
    });
    try {
      if (options.sessionImportFile) {
        const context = session.browser.contexts()[0];
        if (!context) throw new Error("Chrome has no context");
        await importEbaySession(context, options.sessionImportFile);
      }
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  };
  const fetchHtml: HtmlFetcher = async (query, callerSignal, itemId) => {
    if (itemId && !/^\d{9,15}$/.test(itemId))
      throw new Error("Invalid eBay item ID");
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal
      ? AbortSignal.any([deadline, callerSignal])
      : deadline;
    let page: Page | undefined;
    let activeSession: ChromeSession | undefined;
    let pageClosing: Promise<void> | undefined;
    const closePage = (): Promise<void> => {
      if (!page) return Promise.resolve();
      return (pageClosing ??= page.close().catch(() => {}));
    };
    let rejectAbort: (reason: unknown) => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const abort = (): void => {
      rejectAbort(signal.reason);
      void closePage();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      let session: ChromeSession;
      try {
        session = await Promise.race([
          (connection ??= connect().then((session) => {
            if (!options.browser)
              session.browser.once("disconnected", () => {
                connection = undefined;
                void session.close().catch(() => {});
              });
            return session;
          })),
          aborted,
        ]);
      } catch (error) {
        if (signal.aborted) throw error;
        connection = undefined;
        throw new ScrapeError(
          "BROWSER_UNAVAILABLE",
          "Unable to connect to Google Chrome. Check Chrome installation or EBAY_CHROME_CDP.",
          503,
        );
      }
      activeSession = session;
      signal.throwIfAborted();
      const context = session.browser.contexts()[0];
      if (!context)
        throw new ScrapeError(
          "BROWSER_UNAVAILABLE",
          "Chrome has no browser context.",
          503,
        );
      page = await Promise.race([
        context.newPage().then((opened) => {
          if (signal.aborted) {
            void opened.close().catch(() => {});
            throw signal.reason;
          }
          page = opened;
          return opened;
        }),
        aborted,
      ]);
      signal.throwIfAborted();
      const content = await Promise.race([
        search(
          page,
          query,
          timeoutMs,
          Boolean(options.profilePath),
          itemId,
          options.recoveryWait,
        ),
        aborted,
      ]);
      signal.throwIfAborted();
      if (Buffer.byteLength(content) > maxBytes)
        throw new ScrapeError(
          "UPSTREAM_TOO_LARGE",
          "eBay rendered HTML exceeded the size limit.",
        );
      return content;
    } catch (error) {
      if (
        error instanceof ScrapeError &&
        error.code === "UPSTREAM_AUTH_REQUIRED"
      )
        throw error;
      if (signal.aborted && !page && !options.browser) {
        // A stalled tab allocation can leave CDP connected but unusable. Recycle
        // the owned browser before the next scheduled search, preserving its profile.
        connection = undefined;
        if (activeSession)
          await closeWithin(() => activeSession!.close(), 3500);
      }
      if (deadline.aborted)
        throw new ScrapeError(
          "UPSTREAM_TIMEOUT",
          "Chrome search timed out.",
          504,
        );
      if (callerSignal?.aborted)
        throw new ScrapeError("REQUEST_CANCELLED", "Request cancelled.", 499);
      if (error instanceof ScrapeError) throw error;
      throw new ScrapeError(
        "UPSTREAM_BROWSER_ERROR",
        "Chrome could not complete the eBay search.",
      );
    } finally {
      signal.removeEventListener("abort", abort);
      if (page) await closeWithin(closePage, 1000);
    }
  };
  return {
    fetchHtml,
    close: async () => {
      await connection?.then((session) => session.close()).catch(() => {});
    },
  };
}
