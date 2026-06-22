import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { fetchWithRetry, fetchJson } from "./fetchWithRetry";

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const noSleep = () => Promise.resolve();

describe("fetchWithRetry", () => {
  it("returns immediately on a 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: 1 }));
    const res = await fetchWithRetry(
      "https://x",
      {},
      { fetchImpl, sleep: noSleep },
    );
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries on 500 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }, 200));
    const res = await fetchWithRetry(
      "https://x",
      {},
      { fetchImpl, sleep: noSleep },
    );
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 and honors Retry-After", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429, { "retry-after": "2" }))
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }, 200));
    const res = await fetchWithRetry("https://x", {}, { fetchImpl, sleep });
    expect(res.status).toBe(200);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("gives back the last response after exhausting retries", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    const res = await fetchWithRetry(
      "https://x",
      {},
      { fetchImpl, sleep: noSleep, retries: 2 },
    );
    expect(res.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("retries on a thrown network error then throws if all fail", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(
      fetchWithRetry(
        "https://x",
        {},
        { fetchImpl, sleep: noSleep, retries: 1 },
      ),
    ).rejects.toThrow("ECONNRESET");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    const res = await fetchWithRetry(
      "https://x",
      {},
      { fetchImpl, sleep: noSleep },
    );
    expect(res.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops immediately when the caller signal is already aborted", async () => {
    const fetchImpl = vi.fn();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      fetchWithRetry("https://x", {}, { fetchImpl, signal: ctrl.signal }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("fetchJson", () => {
  it("parses and validates against a schema", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ n: 5 }));
    const out = await fetchJson(
      "https://x",
      z.object({ n: z.number() }),
      {},
      {
        fetchImpl,
        sleep: noSleep,
      },
    );
    expect(out.n).toBe(5);
  });

  it("throws on schema mismatch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ n: "nope" }));
    await expect(
      fetchJson(
        "https://x",
        z.object({ n: z.number() }),
        {},
        { fetchImpl, sleep: noSleep },
      ),
    ).rejects.toThrow();
  });

  it("throws on non-ok status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    await expect(
      fetchJson("https://x", z.object({}), {}, { fetchImpl, sleep: noSleep }),
    ).rejects.toThrow("HTTP 404");
  });
});
