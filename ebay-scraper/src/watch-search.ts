import { comparable } from "./market.js";
import { parseEbayListingTime } from "./ebay-listing-time.js";
import type { HtmlFetcher } from "./transport.js";
import { searchQuerySchema } from "./query.js";
import type { FastifyInstance } from "fastify";
import type { Watch } from "./watcher.js";
import { searchResponseSchema, type Listing } from "./contract.js";
import { PartialScanError, ScrapeError } from "./errors.js";
export function createWatchSearch(
  app: FastifyInstance,
  apiKey?: string,
  shouldStop: () => boolean = () => false,
  details?: {
    fetchHtml: HtmlFetcher;
    seen: (job: string, item: string) => boolean;
    paginateActive?: boolean;
    freshnessMinutes?: () => number | undefined;
    resolveTimes?: (job: Watch, rows: readonly Listing[]) => Promise<Listing[]>;
  },
) {
  return async (job: Watch): Promise<Listing[]> => {
    if (shouldStop()) throw new Error("Stopping");
    const params = new URLSearchParams({
      query: job.query,
      domain: job.domain,
    });
    if (job.mode === "active") params.set("sort_by", "newly_listed");
    else params.set("sold_only", "true");
    const filters = {
      max_price: job.maxPrice,
      min_price: job.minPrice,
      condition: job.condition,
      buying_format: job.buyingFormat,
      free_shipping: job.freeShipping,
      location: job.location,
      language: job.language,
    };
    for (const [key, value] of Object.entries(filters))
      if (value !== undefined) params.set(key, String(value));
    const results: Listing[] = [];
    const enrich = async (): Promise<Listing[]> => {
      if (
        details?.resolveTimes &&
        (job.baselined || details.freshnessMinutes?.() !== undefined) &&
        job.mode === "active" &&
        !job.once
      )
        return details.resolveTimes(job, results);
      if (details && job.baselined && job.mode === "active" && !job.once) {
        const query = searchQuerySchema.parse({
          query: job.query,
          domain: job.domain,
        });
        for (const row of results) {
          if (shouldStop()) throw new Error("Stopping");
          if (row.listed_at || details.seen(job.id, row.item_id)) continue;
          try {
            row.listed_at = parseEbayListingTime(
              await details.fetchHtml(query, undefined, row.item_id),
              row.item_id,
            );
            if (!row.listed_at)
              app.log.warn(
                { event: "ebay_listing_time_missing", item: row.item_id },
                "eBay detail page contained no verified listing start",
              );
          } catch (error) {
            app.log.warn(
              {
                event: "ebay_listing_time_failed",
                item: row.item_id,
                code:
                  error instanceof ScrapeError ? error.code : "DETAIL_FAILED",
              },
              "eBay listing time lookup failed",
            );
            // Preserve the alert when the detail page fails. The notification
            // explicitly says that the seller's listing time is unavailable.
            row.listed_at = null;
          }
        }
      }
      return results;
    };
    let incomplete: ScrapeError | undefined;
    const fingerprints = new Set<string>();
    const ids = new Set<string>();
    const paginated = details?.paginateActive && job.mode === "active";
    const maxPages = paginated
      ? 5
      : job.mode === "sold" && !job.baselined
        ? 3
        : 1;
    for (let page = 1; page <= maxPages; page++) {
      if (shouldStop()) throw new Error("Stopping");
      params.set("page", String(page));
      const response = await app.inject({
        method: "GET",
        url: `/v1/ebay/${job.mode === "active" ? "search" : "completed"}?${params}`,
        headers: apiKey ? { "x-api-key": apiKey } : {},
      });
      if (response.statusCode !== 200) {
        const body: unknown = response.json();
        const code =
          typeof body === "object" &&
          body !== null &&
          "code" in body &&
          typeof body.code === "string"
            ? body.code
            : "SEARCH_FAILED";
        const error = new ScrapeError(
          code,
          "Scheduled search failed",
          response.statusCode,
        );
        if (!results.length) throw error;
        incomplete = error;
        break;
      }
      const result = searchResponseSchema.parse(response.json());
      const fingerprint = result.results.map((row) => row.item_id).join(",");
      if (
        paginated &&
        result.pagination.has_more &&
        (!fingerprint || fingerprints.has(fingerprint))
      ) {
        incomplete = new ScrapeError(
          "UPSTREAM_PAGINATION_STALLED",
          "eBay returned an empty or repeated page while reporting more results.",
          503,
        );
        break;
      }
      fingerprints.add(fingerprint);
      for (const row of result.results)
        if (!ids.has(row.item_id)) {
          ids.add(row.item_id);
          results.push({ ...row, position: results.length + 1 });
        }
      if (!result.pagination.has_more) break;
      if (paginated && job.baselined) {
        const eligible = result.results.filter(
          (row) =>
            !row.is_sponsored &&
            row.exact_match !== false &&
            (job.mode !== "sold" ||
              !job.marketProfile ||
              comparable(job.marketProfile, row)),
        );
        const known = eligible.filter((row) =>
          details.seen(job.id, row.item_id),
        ).length;
        if (known >= 5 || (known > 0 && known === eligible.length)) break;
      }
      if (paginated && page === maxPages)
        incomplete = new ScrapeError(
          "UPSTREAM_INCOMPLETE_RESULTS",
          "New-listing pagination reached its safety limit before a known boundary; scan will retry.",
          503,
        );
    }
    const ready = await enrich();
    if (incomplete)
      throw new PartialScanError(
        /PAGINATION|INCOMPLETE/.test(incomplete.code)
          ? incomplete.code
          : "UPSTREAM_PARTIAL_SCAN",
        `${incomplete.code}: ${incomplete.message}`,
        ready,
      );
    return ready;
  };
}
