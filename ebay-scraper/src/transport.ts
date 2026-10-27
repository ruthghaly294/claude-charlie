import { Impit } from "impit";
import { ScrapeError } from "./errors.js";
import { buildSearchUrl, markets, type SearchQuery } from "./query.js";

export type UpstreamPage = {
  readonly status: number;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
};
export type PageFetcher = (
  url: URL,
  signal: AbortSignal,
  locale: string,
) => Promise<UpstreamPage>;
export type HtmlFetcher = (
  query: SearchQuery,
  signal?: AbortSignal,
) => Promise<string>;

type Options = {
  readonly fetchPage?: PageFetcher;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly proxyUrl?: string;
};

async function readBody(
  page: UpstreamPage,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const body = page.body;
  if (!body)
    throw new ScrapeError(
      "UPSTREAM_EMPTY_BODY",
      "eBay returned an empty body.",
    );
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const cancel = (): void => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes)
        throw new ScrapeError(
          "UPSTREAM_TOO_LARGE",
          "eBay response exceeded the HTML size limit.",
        );
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createHtmlFetcher(options: Options = {}): HtmlFetcher {
  const timeoutMs = options.timeoutMs ?? 20000;
  const maxBytes = options.maxBytes ?? 12 * 1024 * 1024;
  const client = new Impit({
    browser: "chrome",
    timeout: timeoutMs,
    followRedirects: false,
    ...(options.proxyUrl ? { proxyUrl: options.proxyUrl } : {}),
  });
  const fetchPage: PageFetcher =
    options.fetchPage ??
    ((url, signal, locale) =>
      client.fetch(url.href, {
        signal,
        headers: {
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "accept-language": `${locale},en;q=0.8`,
          "upgrade-insecure-requests": "1",
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
          "sec-fetch-user": "?1",
        },
      }));
  return async (query, callerSignal) => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal
      ? AbortSignal.any([deadline, callerSignal])
      : deadline;
    try {
      signal.throwIfAborted();
      const page = await fetchPage(
        buildSearchUrl(query),
        signal,
        markets[query.domain].locale,
      );
      if (page.status !== 200) {
        await page.body?.cancel();
        if (page.status === 403 || page.status === 429)
          throw new ScrapeError(
            "UPSTREAM_BLOCKED",
            "eBay blocked this request; no listings were returned.",
          );
        if (page.status >= 300 && page.status < 400)
          throw new ScrapeError(
            "UPSTREAM_REDIRECT",
            "eBay redirected this request; redirects are not followed.",
          );
        throw new ScrapeError(
          "UPSTREAM_HTTP_ERROR",
          `eBay returned HTTP ${page.status}.`,
        );
      }
      if (
        !/^text\/html(?:;|$)|^application\/xhtml\+xml(?:;|$)/i.test(
          page.headers.get("content-type") ?? "",
        )
      ) {
        await page.body?.cancel();
        throw new ScrapeError(
          "UPSTREAM_CONTENT_TYPE",
          "eBay returned a non-HTML response.",
        );
      }
      return await readBody(page, maxBytes, signal);
    } catch (error) {
      if (error instanceof ScrapeError) throw error;
      if (deadline.aborted)
        throw new ScrapeError(
          "UPSTREAM_TIMEOUT",
          "eBay request timed out.",
          504,
        );
      if (callerSignal?.aborted)
        throw new ScrapeError("REQUEST_CANCELLED", "Request cancelled.", 499);
      throw new ScrapeError("UPSTREAM_NETWORK_ERROR", "Unable to reach eBay.");
    }
  };
}
