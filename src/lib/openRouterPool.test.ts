import { describe, it, expect, vi } from "vitest";
import {
  OpenRouterKeyPool,
  OpenRouterPoolError,
  parseOpenRouterKeys,
  extractMessageContent,
} from "./openRouterPool";

function okResponse(content = "hello", usage?: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }], usage }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function errResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response("nope", { status, headers });
}

function authHeader(call: unknown[]): string {
  const init = call[1] as RequestInit;
  const headers = init.headers as Record<string, string>;
  return headers.authorization ?? "";
}

describe("extractMessageContent", () => {
  it("returns a plain string content", () => {
    expect(extractMessageContent({ content: "hello" })).toBe("hello");
  });
  it("joins an array of content parts", () => {
    expect(
      extractMessageContent({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }),
    ).toBe("ab");
  });
  it("falls back to reasoning fields when content is null/empty (reasoning models)", () => {
    expect(extractMessageContent({ content: null, reasoning: '{"x":1}' })).toBe('{"x":1}');
    expect(extractMessageContent({ content: "", reasoning_content: "answer" })).toBe("answer");
  });
  it("returns '' when there is genuinely nothing usable", () => {
    expect(extractMessageContent(undefined)).toBe("");
    expect(extractMessageContent({ content: null })).toBe("");
    expect(extractMessageContent({ content: [] })).toBe("");
  });
});

describe("OpenRouterKeyPool content tolerance", () => {
  it("reads array-shaped content from a model response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "hi there" }] } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const pool = new OpenRouterKeyPool({
      keys: ["k1"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
    });
    const res = await pool.complete({ model: "m", messages: [] });
    expect(res?.content).toBe("hi there");
  });

  it("retries on an empty-content 200 (transient free-tier hiccup) instead of failing", async () => {
    const empty = () =>
      new Response(JSON.stringify({ choices: [{ message: { content: null } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const good = () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "recovered" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const fetchImpl = vi.fn().mockResolvedValueOnce(empty()).mockResolvedValueOnce(good());
    const pool = new OpenRouterKeyPool({
      keys: ["k1", "k2"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
    });
    const res = await pool.complete({ model: "m", messages: [] });
    expect(res?.content).toBe("recovered");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("parseOpenRouterKeys", () => {
  it("splits OPENROUTER_API_KEYS on commas, trims, and dedupes", () => {
    expect(
      parseOpenRouterKeys({ OPENROUTER_API_KEYS: " a , b ,a, " }),
    ).toEqual(["a", "b"]);
  });

  it("falls back to the single OPENROUTER_API_KEY", () => {
    expect(parseOpenRouterKeys({ OPENROUTER_API_KEY: "solo" })).toEqual(["solo"]);
  });

  it("prefers the multi-key var when both are set", () => {
    expect(
      parseOpenRouterKeys({ OPENROUTER_API_KEYS: "x,y", OPENROUTER_API_KEY: "z" }),
    ).toEqual(["x", "y"]);
  });

  it("returns an empty array when nothing is configured", () => {
    expect(parseOpenRouterKeys({})).toEqual([]);
  });
});

describe("OpenRouterKeyPool", () => {
  const noSleep = () => Promise.resolve();

  it("throws when constructed with no keys", () => {
    expect(() => new OpenRouterKeyPool({ keys: [] })).toThrow(
      OpenRouterPoolError,
    );
  });

  it("round-robins across keys on successive calls", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const pool = new OpenRouterKeyPool({
      keys: ["k1", "k2", "k3"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    await pool.complete({});
    await pool.complete({});
    await pool.complete({});

    expect(authHeader(fetchImpl.mock.calls[0]!)).toBe("Bearer k1");
    expect(authHeader(fetchImpl.mock.calls[1]!)).toBe("Bearer k2");
    expect(authHeader(fetchImpl.mock.calls[2]!)).toBe("Bearer k3");
  });

  it("returns parsed content and usage on success", async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse("answer", { prompt_tokens: 10, completion_tokens: 4 }),
    );
    const pool = new OpenRouterKeyPool({
      keys: ["k1"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    const res = await pool.complete({});
    expect(res.content).toBe("answer");
    expect(res.usage).toEqual({ prompt_tokens: 10, completion_tokens: 4 });
  });

  it("fails over to the next key on 429 and honors Retry-After", async () => {
    const slept: number[] = [];
    let now = 1000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errResponse(429, { "retry-after": "2" }))
      .mockResolvedValueOnce(okResponse("ok"));
    const pool = new OpenRouterKeyPool({
      keys: ["k1", "k2"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async (ms) => {
        slept.push(ms);
      },
      now: () => now,
    });

    const res = await pool.complete({});
    expect(res.content).toBe("ok");
    expect(authHeader(fetchImpl.mock.calls[0]!)).toBe("Bearer k1");
    expect(authHeader(fetchImpl.mock.calls[1]!)).toBe("Bearer k2");

    // k1 is now cooling down for 2s; the next call should skip to k2 without
    // burning a 429, and a wait should only occur once all live keys cool down.
    now = 1500; // still within k1's cooldown window (available at 3000)
    fetchImpl.mockResolvedValueOnce(okResponse("again"));
    const res2 = await pool.complete({});
    expect(res2.content).toBe("again");
    expect(authHeader(fetchImpl.mock.calls[2]!)).toBe("Bearer k2");
  });

  it("permanently drops a key on 401 and never reuses it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errResponse(401))
      .mockImplementation(async () => okResponse("ok"));
    const pool = new OpenRouterKeyPool({
      keys: ["bad", "good"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(pool.activeSize).toBe(2);
    const res = await pool.complete({});
    expect(res.content).toBe("ok");
    expect(pool.activeSize).toBe(1);

    await pool.complete({});
    const used = fetchImpl.mock.calls.slice(1).map(authHeader);
    expect(used.every((h) => h === "Bearer good")).toBe(true);
  });

  it("throws once every key is dead", async () => {
    const fetchImpl = vi.fn(async () => errResponse(403));
    const pool = new OpenRouterKeyPool({
      keys: ["a", "b"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    await expect(pool.complete({})).rejects.toThrow(/rejected|exhausted/i);
    expect(pool.activeSize).toBe(0);
  });

  it("does not fail over on a non-retryable 400", async () => {
    const fetchImpl = vi.fn(async () => errResponse(400));
    const pool = new OpenRouterKeyPool({
      keys: ["a", "b"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    await expect(pool.complete({})).rejects.toThrow(/400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(pool.activeSize).toBe(2);
  });

  it("caps in-flight requests at maxConcurrency", async () => {
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const fetchImpl = vi.fn(() => {
      active += 1;
      peak = Math.max(peak, active);
      return new Promise<Response>((resolve) => {
        release.push(() => {
          active -= 1;
          resolve(okResponse());
        });
      });
    });
    const pool = new OpenRouterKeyPool({
      keys: ["a", "b", "c", "d"],
      maxConcurrency: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    const calls = [pool.complete({}), pool.complete({}), pool.complete({})];
    await vi.waitFor(() => expect(release.length).toBe(2));
    expect(peak).toBe(2);
    release.forEach((r) => r());
    await vi.waitFor(() => expect(release.length).toBe(3));
    release.slice(2).forEach((r) => r());
    await Promise.all(calls);
    expect(peak).toBe(2);
  });
});
