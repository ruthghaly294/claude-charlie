import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";
import { searchResponseSchema } from "../src/contract.js";
import { ScrapeError } from "../src/errors.js";

const html = readFileSync(
  new URL("./fixtures/search.html", import.meta.url),
  "utf8",
);
const url = "/v1/ebay/search?query=charizard&domain=co.uk";

describe("HTTP search service", () => {
  it("aborts upstream work when a real HTTP client disconnects and releases capacity", async () => {
    let started: () => void = () => {};
    let aborted: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const cancelled = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    let count = 0;
    const app = buildApp({
      maxConcurrent: 1,
      fetchHtml: async (_query, signal) => {
        count++;
        if (count > 1) return html;
        started();
        return new Promise<string>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              aborted();
              reject(
                new ScrapeError("REQUEST_CANCELLED", "Request cancelled.", 499),
              );
            },
            { once: true },
          );
        });
      },
    });
    const controller = new AbortController();
    try {
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      const request = fetch(address + url, { signal: controller.signal });
      await ready;
      controller.abort();
      await expect(request).rejects.toThrow();
      await cancelled;
      expect((await fetch(address + url)).status).toBe(200);
    } finally {
      controller.abort();
      await app.close();
    }
  });
  it("returns compatible JSON with request metadata but no invented billing headers", async () => {
    const app = buildApp({ fetchHtml: async () => html });
    try {
      const reply = await app.inject(url);
      expect(reply.statusCode).toBe(200);
      expect(searchResponseSchema.parse(reply.json()).results).toHaveLength(2);
      expect(reply.headers["x-request-id"]).toBeTruthy();
      expect(
        Number(reply.headers["x-request-duration-ms"]),
      ).toBeGreaterThanOrEqual(0);
      expect(reply.headers["x-credits-used"]).toBeUndefined();
      expect(reply.headers["cache-control"]).toBe("no-store");
    } finally {
      await app.close();
    }
  });

  it.each([
    "",
    "?query=x&domain=evil.test",
    "?query=x&query=y",
    "?query=x&min_price=-1",
  ])("rejects malformed requests without fetching %s", async (suffix) => {
    let fetched = false;
    const app = buildApp({
      fetchHtml: async () => {
        fetched = true;
        return html;
      },
    });
    try {
      const reply = await app.inject(`/v1/ebay/search${suffix}`);
      expect(reply.statusCode).toBe(400);
      expect(reply.json()).toMatchObject({
        code: "INVALID_QUERY",
        detail: expect.any(String),
      });
      expect(fetched).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("requires the configured local API key", async () => {
    const app = buildApp({
      apiKey: "test-service-key",
      fetchHtml: async () => html,
    });
    try {
      expect((await app.inject(url)).statusCode).toBe(401);
      expect(
        (await app.inject({ url, headers: { "x-api-key": "wrong" } }))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            url,
            headers: { "x-api-key": "test-service-key" },
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("reports blocked or changed upstream pages as errors", async () => {
    const app = buildApp({
      fetchHtml: async () => "<title>Error Page | eBay</title>",
    });
    try {
      const reply = await app.inject(url);
      expect(reply.statusCode).toBe(503);
      expect(reply.json()).toMatchObject({ code: "UPSTREAM_TEMPORARY_ERROR" });
    } finally {
      await app.close();
    }
  });

  it("preserves upstream timeout status and hides internal error details", async () => {
    const timedOut = buildApp({
      fetchHtml: async () => {
        throw new ScrapeError(
          "UPSTREAM_TIMEOUT",
          "eBay request timed out.",
          504,
        );
      },
    });
    const broken = buildApp({
      fetchHtml: async () => {
        throw new Error("password=secret");
      },
    });
    try {
      expect((await timedOut.inject(url)).statusCode).toBe(504);
      const reply = await broken.inject(url);
      expect(reply.statusCode).toBe(500);
      expect(reply.body).not.toContain("secret");
    } finally {
      await timedOut.close();
      await broken.close();
    }
  });

  it("bounds concurrency and releases capacity after a failed request", async () => {
    let started: () => void = () => {};
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const app = buildApp({
      maxConcurrent: 1,
      fetchHtml: async () => {
        started();
        await pending;
        throw new Error("failure");
      },
    });
    try {
      const first = app.inject(url).then((reply) => reply);
      await ready;
      const crowded = await app.inject(url);
      expect(crowded.statusCode).toBe(429);
      expect(crowded.headers["retry-after"]).toBe("1");
      finish();
      expect((await first).statusCode).toBe(500);
      expect((await app.inject(url)).statusCode).toBe(500);
    } finally {
      finish();
      await app.close();
    }
  });
});
