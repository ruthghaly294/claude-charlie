import { setTimeout as delay } from "node:timers/promises";
import type { HtmlFetcher } from "./transport.js";

// Share one lane across search and detail fetches; pacing only watch starts
// leaves the detail requests immediately after a search in an unpaced burst.
export function paceHtmlFetcher(
  fetchHtml: HtmlFetcher,
  options: {
    gapMs: number;
    clock?: () => number;
    wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  },
): HtmlFetcher {
  const clock = options.clock ?? (() => performance.now());
  const wait =
    options.wait ??
    (async (ms, signal) => {
      await delay(ms, undefined, { signal });
    });
  let tail: Promise<void> = Promise.resolve();
  let lastFinished = -Infinity;
  return (query, signal, itemId) => {
    const result = tail.then(async () => {
      signal?.throwIfAborted();
      const remaining = lastFinished + options.gapMs - clock();
      if (remaining > 0) await wait(remaining, signal);
      signal?.throwIfAborted();
      try {
        return await fetchHtml(query, signal, itemId);
      } finally {
        // Internal recovery can navigate again near the end of a slow fetch.
        lastFinished = clock();
      }
    });
    tail = result.then(
      () => {},
      () => {},
    );
    if (!signal) return result;
    return new Promise<string>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      const cleanup = () => signal.removeEventListener("abort", abort);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      result.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  };
}
