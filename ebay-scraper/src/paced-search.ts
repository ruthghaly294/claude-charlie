import { setTimeout as delay } from "node:timers/promises";
import type { Listing } from "./contract.js";
import type { Watch } from "./watcher.js";

export function paceSearch(
  search: (watch: Watch) => Promise<readonly Listing[]>,
  options: {
    gapMs: number;
    clock?: () => number;
    wait?: (ms: number) => Promise<void>;
    shouldStop?: () => boolean;
  },
): (watch: Watch) => Promise<readonly Listing[]> {
  const clock = options.clock ?? (() => performance.now());
  const wait =
    options.wait ??
    (async (ms) => {
      await delay(ms);
    });
  const shouldStop = options.shouldStop ?? (() => false);
  let lastStarted = -Infinity;
  // The watch runner is sequential. Keep this wrapper across cycles so errors
  // and cycle boundaries cannot turn the saved searches into a request burst.
  return async (watch) => {
    if (shouldStop()) throw new Error("Stopping");
    const remaining = lastStarted + options.gapMs - clock();
    if (remaining > 0) await wait(remaining);
    if (shouldStop()) throw new Error("Stopping");
    lastStarted = clock();
    return search(watch);
  };
}
