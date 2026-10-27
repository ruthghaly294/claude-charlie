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
};

async function search(
  page: Page,
  query: SearchQuery,
  timeoutMs: number,
  persistentProfile: boolean,
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
    if (!persistentProfile) {
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
      if (
        /error page \| ebay|pardon our interruption|access denied/i.test(
          await page.title(),
        )
      )
        return first;
    }
    await page.goto(buildSearchUrl(query).href, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator(
        ".srp-results, .srp-controls__count-heading, #error-info, #captcha_form",
      )
      .first()
      .waitFor({ state: "attached" });
    return page.content();
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
  const fetchHtml: HtmlFetcher = async (query, callerSignal) => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal
      ? AbortSignal.any([deadline, callerSignal])
      : deadline;
    let page: Page | undefined;
    let rejectAbort: (reason: unknown) => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const abort = (): void => {
      rejectAbort(signal.reason);
      void page?.close().catch(() => {});
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
      signal.throwIfAborted();
      const context = session.browser.contexts()[0];
      if (!context)
        throw new ScrapeError(
          "BROWSER_UNAVAILABLE",
          "Chrome has no browser context.",
          503,
        );
      page = await context.newPage();
      signal.throwIfAborted();
      const content = await search(
        page,
        query,
        timeoutMs,
        Boolean(options.profilePath),
      );
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
      await page?.close().catch(() => {});
    }
  };
  return {
    fetchHtml,
    close: async () => {
      await connection?.then((session) => session.close()).catch(() => {});
    },
  };
}
