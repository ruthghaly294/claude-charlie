import { describe, expect, it } from "vitest";
import { createHtmlFetcher, type PageFetcher } from "../src/transport.js";
import { searchQuerySchema } from "../src/query.js";

const query = searchQuerySchema.parse({ query: "charizard", domain: "co.uk" });
describe("bounded eBay transport", () => {
  it("fetches only the generated eBay URL and consumes HTML", async () => {
    const fetchPage: PageFetcher = async (url) => {
      expect(url.origin).toBe("https://www.ebay.co.uk");
      expect(url.pathname).toBe("/sch/i.html");
      return new Response("<html>listing</html>", {
        headers: { "content-type": "text/html" },
      });
    };
    expect(await createHtmlFetcher({ fetchPage })(query)).toBe(
      "<html>listing</html>",
    );
  });
  it.each([
    [403, "UPSTREAM_BLOCKED"],
    [429, "UPSTREAM_BLOCKED"],
    [302, "UPSTREAM_REDIRECT"],
    [503, "UPSTREAM_HTTP_ERROR"],
  ])(
    "reports upstream HTTP %s without following or retrying it",
    async (status, code) => {
      let requests = 0;
      const fetchHtml = createHtmlFetcher({
        fetchPage: async () => {
          requests++;
          return new Response("upstream", {
            status,
            headers: { location: "http://127.0.0.1/admin" },
          });
        },
      });
      await expect(fetchHtml(query)).rejects.toMatchObject({
        code,
        statusCode: 502,
      });
      expect(requests).toBe(1);
    },
  );
  it("rejects non-HTML responses", async () => {
    await expect(
      createHtmlFetcher({
        fetchPage: async () =>
          new Response("{}", {
            headers: { "content-type": "application/json" },
          }),
      })(query),
    ).rejects.toMatchObject({ code: "UPSTREAM_CONTENT_TYPE" });
  });
  it("limits decompressed streamed bytes even without a content-length header", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("123456"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchHtml = createHtmlFetcher({
      maxBytes: 5,
      fetchPage: async () =>
        new Response(stream, { headers: { "content-type": "text/html" } }),
    });
    await expect(fetchHtml(query)).rejects.toMatchObject({
      code: "UPSTREAM_TOO_LARGE",
    });
    expect(cancelled).toBe(true);
  });
  it("accepts a body at exactly the byte limit", async () => {
    const fetchHtml = createHtmlFetcher({
      maxBytes: 5,
      fetchPage: async () =>
        new Response("12345", { headers: { "content-type": "text/html" } }),
    });
    expect(await fetchHtml(query)).toBe("12345");
  });
  it("sanitizes transport errors", async () => {
    const fetchHtml = createHtmlFetcher({
      fetchPage: async () => {
        throw new Error("proxy password=secret");
      },
    });
    await expect(fetchHtml(query)).rejects.toMatchObject({
      code: "UPSTREAM_NETWORK_ERROR",
      message: "Unable to reach eBay.",
    });
  });
  it("aborts requests at the deadline", async () => {
    const fetchPage: PageFetcher = async (_url, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    await expect(
      createHtmlFetcher({ timeoutMs: 10, fetchPage })(query),
    ).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT", statusCode: 504 });
  });

  it("aborts a stalled body after headers have arrived", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const fetchHtml = createHtmlFetcher({
      timeoutMs: 10,
      fetchPage: async () =>
        new Response(stream, { headers: { "content-type": "text/html" } }),
    });
    await expect(fetchHtml(query)).rejects.toMatchObject({
      code: "UPSTREAM_TIMEOUT",
    });
    expect(cancelled).toBe(true);
  });

  it("does not make a network request after caller cancellation", async () => {
    let fetched = false;
    const controller = new AbortController();
    controller.abort();
    const fetchHtml = createHtmlFetcher({
      fetchPage: async () => {
        fetched = true;
        return new Response();
      },
    });
    await expect(fetchHtml(query, controller.signal)).rejects.toMatchObject({
      code: "REQUEST_CANCELLED",
      statusCode: 499,
    });
    expect(fetched).toBe(false);
  });

  it("rejects an empty upstream response body", async () => {
    const fetchHtml = createHtmlFetcher({
      fetchPage: async () =>
        new Response(null, { headers: { "content-type": "text/html" } }),
    });
    await expect(fetchHtml(query)).rejects.toMatchObject({
      code: "UPSTREAM_EMPTY_BODY",
    });
  });
});
