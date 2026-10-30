import { expect, it } from "vitest";
import { paceHtmlFetcher } from "../src/paced-fetch.js";
import { searchQuerySchema } from "../src/query.js";
it("paces searches and item detail requests together, including concurrent callers and failed requests", async () => {
  let now = 0;
  const starts: number[] = [];
  const fetch = paceHtmlFetcher(
    async (_q, _s, id) => {
      starts.push(now);
      if (!id) throw Error("temporary");
      return id;
    },
    {
      gapMs: 20000,
      clock: () => now,
      wait: async (ms) => {
        now += ms;
      },
    },
  );
  const q = searchQuerySchema.parse({ query: "chair" });
  const results = await Promise.allSettled([
    fetch(q),
    fetch(q, undefined, "188151380608"),
    fetch(q, undefined, "188151380609"),
  ]);
  expect(starts).toEqual([0, 20000, 40000]);
  expect(results.map((result) => result.status)).toEqual([
    "rejected",
    "fulfilled",
    "fulfilled",
  ]);
});
it("cancels a queued lookup without making its request", async () => {
  let calls = 0;
  const controller = new AbortController();
  const fetch = paceHtmlFetcher(
    async () => {
      calls++;
      return "ok";
    },
    {
      gapMs: 20000,
      clock: () => 0,
      wait: async () => {
        controller.abort();
      },
    },
  );
  const q = searchQuerySchema.parse({ query: "chair" });
  await fetch(q);
  await expect(fetch(q, controller.signal, "188151380608")).rejects.toThrow();
  expect(calls).toBe(1);
});

it("rejects cancellation promptly while another fetch is still running", async () => {
  let finish: (value: string) => void = () => {};
  const fetch = paceHtmlFetcher(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    { gapMs: 0 },
  );
  const q = searchQuerySchema.parse({ query: "chair" });
  const first = fetch(q);
  await Promise.resolve();
  const controller = new AbortController();
  const queued = fetch(q, controller.signal, "188151380608");
  controller.abort();
  try {
    await expect(queued).rejects.toThrow();
  } finally {
    finish("done");
    await first;
  }
});

it("keeps the next fetch spaced after a slow request or its internal recovery retry", async () => {
  let now = 0;
  const starts: number[] = [];
  const fetch = paceHtmlFetcher(
    async () => {
      starts.push(now);
      now += 30000;
      return "ok";
    },
    {
      gapMs: 20000,
      clock: () => now,
      wait: async (ms) => {
        now += ms;
      },
    },
  );
  const q = searchQuerySchema.parse({ query: "chair" });
  await fetch(q);
  await fetch(q, undefined, "188151380608");
  expect(starts).toEqual([0, 50000]);
});
