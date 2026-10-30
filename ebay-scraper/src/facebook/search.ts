import { freshListing } from "../alert-freshness.js";
import { listingSchema, type Listing } from "../contract.js";
import { PartialScanError, ScrapeError } from "../errors.js";
import type { Watch } from "../watcher.js";
import type { FacebookListing } from "./contract.js";
import { eastBelfast, type Coordinates } from "./geo.js";
import {
  hasEmptySearchFeed,
  parseListingCoordinates,
  parseListingTime,
  parseSearchPayloads,
} from "./parser.js";
import { localListings, relevantTitle } from "./results.js";

export type FacebookPage = {
  path: string;
  payloads: string[];
  incomplete?: boolean;
};

const signIn = /^\/(login|checkpoint|two_step_verification)\b/;
async function open(
  load: (url: string) => Promise<FacebookPage>,
  url: string,
): Promise<FacebookPage> {
  const page = await load(url);
  if (signIn.test(page.path))
    throw new ScrapeError(
      "UPSTREAM_AUTH_REQUIRED",
      "Facebook requires sign-in",
      503,
    );
  return page;
}
const recorded = (row: FacebookListing, position: number): Listing =>
  listingSchema.parse({
    position,
    item_id: row.id,
    listed_at: row.listedAt,
    title: row.title,
    url: row.url,
    image: row.image,
    price: row.price,
    condition: null,
    is_auction: false,
    location: row.locationName,
  });

export function createFacebookSearch(options: {
  load: (url: string) => Promise<FacebookPage>;
  seen?: (job: string, item: string) => boolean;
  onVerified?: (job: Watch, listing: Listing) => Promise<void>;
  maxAgeMinutes?: () => number | undefined;
  clock?: () => number;
  onScan?: (stats: {
    watch: string;
    parsed: number;
    matching: number;
    withinRadius: number;
    unknownLocation: number;
    detailFailures: number;
  }) => void;
}): (job: Watch) => Promise<Listing[]> {
  const located = new Map<string, Coordinates | null>();
  const listingTimes = new Map<string, string | null>();
  const seen = options.seen ?? (() => false);
  return async (job) => {
    const params = new URLSearchParams({
      query: job.query,
      sortBy: "creation_time_descend",
      exact: "false",
    });
    if (job.baselined && !job.once) params.set("daysSinceListed", "1");
    if (job.minPrice !== undefined)
      params.set("minPrice", String(job.minPrice));
    if (job.maxPrice !== undefined)
      params.set("maxPrice", String(job.maxPrice));
    const page = await open(
      options.load,
      `https://www.facebook.com/marketplace/belfast/search/?${params}`,
    );
    const parsed = parseSearchPayloads(page.payloads);
    if (!parsed.length && !hasEmptySearchFeed(page.payloads))
      throw new ScrapeError(
        "UPSTREAM_MARKUP_CHANGED",
        "Facebook search data was not recognized; refusing to record an empty scan.",
      );
    const candidates = parsed.filter(
      (row) =>
        row.availability === "available" &&
        // Free listings rarely name their category ("Yellow iris").
        (job.maxPrice === 0 || relevantTitle(job.query, row.title)) &&
        (job.minPrice === undefined ||
          (row.price !== null && row.price.value >= job.minPrice)) &&
        (job.maxPrice === undefined ||
          (row.price !== null && row.price.value <= job.maxPrice)),
    );
    // Facebook already limits results to the account's radius; only listings
    // that could alert need their exact location opened.
    const maxAge = job.once ? undefined : options.maxAgeMinutes?.();
    const now = options.clock?.() ?? Date.now();
    let detailFailures = 0;
    const fresh =
      job.baselined || maxAge !== undefined
        ? candidates.filter(
            (row) =>
              !seen(job.id, row.id) &&
              (maxAge === undefined ||
                !row.listedAt ||
                freshListing(recorded(row, 1), now, maxAge)),
          )
        : [];
    const area = {
      query: job.maxPrice === 0 ? "" : job.query,
      latitude: job.latitude ?? eastBelfast.latitude,
      longitude: job.longitude ?? eastBelfast.longitude,
      radiusKm: job.radiusKm ?? 40,
    };
    for (const row of fresh) {
      if (
        !located.get(row.id) ||
        (!row.listedAt && !listingTimes.get(row.id))
      ) {
        try {
          const detail = await open(options.load, row.url);
          located.set(row.id, parseListingCoordinates(detail.payloads, row.id));
          listingTimes.set(row.id, parseListingTime(detail.payloads, row.id));
        } catch (error) {
          if (
            error instanceof ScrapeError &&
            error.code === "UPSTREAM_AUTH_REQUIRED"
          )
            throw error;
          detailFailures++;
        }
      }
      const verified = localListings(
        [
          {
            ...row,
            coordinates: located.get(row.id) ?? null,
            listedAt: listingTimes.get(row.id) ?? row.listedAt,
          },
        ],
        area,
      ).results[0];
      if (
        verified &&
        maxAge !== undefined &&
        freshListing(verified, options.clock?.() ?? Date.now(), maxAge)
      )
        await options.onVerified?.(job, verified);
    }
    const known = candidates
      .filter((row) => !fresh.includes(row))
      .map((row, index) => recorded(row, index + 1));
    const local = localListings(
      fresh.map((row) => ({
        ...row,
        coordinates: located.get(row.id) ?? null,
        listedAt: listingTimes.get(row.id) ?? row.listedAt,
      })),
      {
        // Relevance was already decided above; an empty query matches all.
        query: job.maxPrice === 0 ? "" : job.query,
        latitude: job.latitude ?? eastBelfast.latitude,
        longitude: job.longitude ?? eastBelfast.longitude,
        radiusKm: job.radiusKm ?? 40,
      },
    );
    const near = local.results.map((row, index) => ({
      ...row,
      position: known.length + index + 1,
    }));
    const results = [...known, ...near];
    options.onScan?.({
      watch: job.name,
      parsed: parsed.length,
      matching: candidates.length,
      withinRadius: near.length,
      unknownLocation: local.unknownLocation,
      detailFailures,
    });
    if (
      page.incomplete ||
      detailFailures ||
      (maxAge !== undefined && local.unknownLocation)
    )
      throw new PartialScanError(
        "UPSTREAM_PARTIAL_SCAN",
        page.incomplete
          ? "Facebook pagination was incomplete; verified matches retained while remaining results retry."
          : "Some Facebook listing details could not be verified; valid matches retained and missing details will retry.",
        results,
      );
    return results;
  };
}
