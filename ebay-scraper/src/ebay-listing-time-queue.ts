import { z } from "zod";
import { listingSchema, type Listing } from "./contract.js";
import { comparable } from "./market.js";
import { parseEbayListingTime } from "./ebay-listing-time.js";
import { searchQuerySchema } from "./query.js";
import type { HtmlFetcher } from "./transport.js";
import type { Watch } from "./watcher.js";

const pendingSchema = z.object({
  row: listingSchema,
  firstSeenAt: z.number(),
  attempts: z.number(),
  lastAttemptAt: z.number().optional(),
});
const stateSchema = z.object({
  identity: z.string(),
  pending: z.array(pendingSchema),
});
type Pending = z.infer<typeof pendingSchema>;
export function createEbayListingTimeQueue(options: {
  store: {
    setting(key: string): string | undefined;
    setSetting(key: string, value: string): void;
  };
  fetchHtml: HtmlFetcher;
  seen: (job: string, item: string) => boolean;
  clock?: () => number;
  shouldStop?: () => boolean;
  failed?: (item: string, error?: unknown) => void;
}) {
  const clock = options.clock ?? Date.now;
  const resolve = async (
    job: Watch,
    current: readonly Listing[],
  ): Promise<Listing[]> => {
    const {
      id,
      baselined,
      nextRun,
      lastSuccess,
      lastError,
      resultCount,
      ...input
    } = job;
    const identity = JSON.stringify(input);
    const key = `ebayTimePending:${id}`;
    let pending: Pending[] = [];
    const saved = options.store.setting(key);
    if (saved) {
      try {
        const state = stateSchema.parse(JSON.parse(saved));
        if (state.identity === identity) pending = state.pending;
      } catch {
        /* Discard invalid local queue state; current results can be retried. */
      }
    }
    const previous = new Map(
      pending.map((entry) => [entry.row.item_id, entry]),
    );
    const rows = new Map(current.map((row) => [row.item_id, row]));
    for (const entry of pending)
      if (!rows.has(entry.row.item_id)) rows.set(entry.row.item_id, entry.row);
    const discoveredAt = clock();
    const output: Listing[] = [];
    const candidates = [...rows.values()].filter((row) => {
      if (
        options.seen(id, row.item_id) ||
        (job.mode === "sold" &&
          job.marketProfile &&
          !comparable(job.marketProfile, row))
      ) {
        output.push(row);
        return false;
      }
      return true;
    });
    const work = new Map(
      candidates.map((row) => [
        row.item_id,
        previous.get(row.item_id) ?? {
          row,
          firstSeenAt: discoveredAt,
          attempts: 0,
        },
      ]),
    );
    const persist = () =>
      options.store.setSetting(
        key,
        JSON.stringify({ identity, pending: [...work.values()] }),
      );
    persist();
    let held = 0;
    let fetched = 0;
    const query = searchQuerySchema.parse({
      query: job.query,
      domain: job.domain,
    });
    const ordered = candidates.sort(
      (a, b) => work.get(a.item_id)!.attempts - work.get(b.item_id)!.attempts,
    );
    for (const raw of ordered) {
      if (options.shouldStop?.()) throw new Error("Stopping");
      const entry = work.get(raw.item_id)!;
      const row = {
        ...raw,
        detected_at:
          raw.detected_at ?? new Date(entry.firstSeenAt).toISOString(),
      };
      if (row.listed_at && Date.parse(row.listed_at) > clock())
        row.listed_at = null;
      const cacheKey = `ebayStartTime:${job.domain}:${row.item_id}`;
      const cached = options.store.setting(cacheKey);
      const cachedDate = cached
        ? z.iso.datetime({ offset: true }).safeParse(cached)
        : undefined;
      row.listed_at ??=
        cachedDate?.success && Date.parse(cachedDate.data) <= clock()
          ? cachedDate.data
          : null;
      if (
        !row.listed_at &&
        fetched < 3 &&
        (entry.lastAttemptAt === undefined ||
          clock() - entry.lastAttemptAt >= 60000)
      ) {
        fetched++;
        entry.attempts++;
        entry.lastAttemptAt = clock();
        persist();
        try {
          const time = parseEbayListingTime(
            await options.fetchHtml(query, undefined, row.item_id),
            row.item_id,
          );
          if (time && Date.parse(time) <= clock()) {
            row.listed_at = time;
            options.store.setSetting(cacheKey, time);
          } else options.failed?.(row.item_id);
        } catch (error) {
          options.failed?.(row.item_id, error);
        }
      }
      if (row.listed_at || clock() - entry.firstSeenAt >= 300000 || held >= 100)
        output.push(row);
      else held++;
      // Retain even resolved rows until WatchStore records them as seen. This
      // preserves the result if shutdown interrupts a later lookup in this scan.
      work.set(row.item_id, { ...entry, row });
      persist();
    }
    return output.map((row, index) => ({ ...row, position: index + 1 }));
  };
  return Object.assign(resolve, {
    hasPending(job: Watch): boolean {
      const saved = options.store.setting(`ebayTimePending:${job.id}`);
      if (!saved) return false;
      try {
        const state = stateSchema.parse(JSON.parse(saved));
        return state.pending.some(
          (entry) => !options.seen(job.id, entry.row.item_id),
        );
      } catch {
        return false;
      }
    },
  });
}
