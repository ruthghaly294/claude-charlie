import type { FastifyInstance } from "fastify";
import type { Watch } from "./watcher.js";
import { searchResponseSchema, type Listing } from "./contract.js";
import { ScrapeError } from "./errors.js";
export function createWatchSearch(
  app: FastifyInstance,
  apiKey?: string,
  shouldStop: () => boolean = () => false,
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
    for (
      let page = 1;
      page <= (job.mode === "sold" && !job.baselined ? 3 : 1);
      page++
    ) {
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
        throw new ScrapeError(
          code,
          "Scheduled search failed",
          response.statusCode,
        );
      }
      const result = searchResponseSchema.parse(response.json());
      results.push(...result.results);
      if (!result.pagination.has_more) break;
    }
    return results;
  };
}
