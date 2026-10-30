import type { Listing } from "./contract.js";
import type { Watch, WatchStore } from "./watcher.js";

// Run independently of search success/backoff. Resolving an item must not reset
// a search's failure history or manufacture a successful scan.
export function createPendingListingTimeWorker(options: {
  store: Pick<WatchStore, "list" | "recordResolvedListings">;
  resolve: ((job: Watch, rows: readonly Listing[]) => Promise<Listing[]>) & {
    hasPending(job: Watch): boolean;
  };
  clock?: () => number;
  shouldStop?: () => boolean;
  failed?: (error: unknown) => void;
}) {
  const clock = options.clock ?? Date.now;
  const lastAttempt = new Map<string, number>();
  return async (): Promise<void> => {
    const watches = options.store.list();
    const current = new Set(watches.map((job) => job.id));
    for (const id of lastAttempt.keys())
      if (!current.has(id)) lastAttempt.delete(id);
    for (const job of watches) {
      if (options.shouldStop?.()) return;
      if (
        job.provider === "facebook" ||
        job.mode !== "active" ||
        !job.baselined ||
        !options.resolve.hasPending(job) ||
        clock() - (lastAttempt.get(job.id) ?? -Infinity) < 60000
      )
        continue;
      lastAttempt.set(job.id, clock());
      try {
        const rows = await options.resolve(job, []);
        options.store.recordResolvedListings(job.id, rows, clock());
      } catch (error) {
        options.failed?.(error);
      }
    }
  };
}
