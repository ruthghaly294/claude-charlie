import { mapWithConcurrency } from "@/lib/concurrency";
import type { RankedReport, RankedItem } from "./rank";

/**
 * Best-effort thumbnail capture for research picks, so the exemplar extractor
 * can SEE what the top performers looked like (vision enrichment), not just read
 * their titles. YouTube has a deterministic thumbnail URL; everything else falls
 * back to the page's og:image / twitter:image. Failures leave imageUrl unset.
 */

const YT_HOST = /(?:^|\.)(youtube\.com|youtu\.be)$/i;

export function youtubeThumbnail(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!YT_HOST.test(parsed.hostname)) return null;
  const id =
    parsed.hostname.toLowerCase().includes("youtu.be")
      ? parsed.pathname.slice(1)
      : parsed.searchParams.get("v");
  if (!id) return null;
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** Pull og:image (or twitter:image) out of raw HTML. */
export function extractOgImage(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

export type FetchThumbnailOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export async function fetchThumbnail(
  url: string,
  opts: FetchThumbnailOptions = {},
): Promise<string | null> {
  const yt = youtubeThumbnail(url);
  if (yt) return yt;
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 4000) });
    if (!res.ok) return null;
    const html = await res.text();
    return extractOgImage(html);
  } catch {
    return null;
  }
}

export type EnrichThumbnailsOptions = FetchThumbnailOptions & {
  /** how many picks to enrich (default: the top 5 the extractor analyses) */
  limit?: number;
  concurrency?: number;
};

/**
 * Return a copy of `report` with `imageUrl` populated on the top picks that lack
 * one. Only the top `limit` picks are fetched (the extractor only reads those).
 */
export async function enrichThumbnails(
  report: RankedReport,
  opts: EnrichThumbnailsOptions = {},
): Promise<RankedReport> {
  const limit = opts.limit ?? 5;
  const targets = report.topPicks.slice(0, limit);
  const resolved = await mapWithConcurrency(targets, opts.concurrency ?? 4, async (pick) =>
    pick.imageUrl ? pick.imageUrl : (await fetchThumbnail(pick.url, opts)) ?? undefined,
  );
  const byUrl = new Map<string, string | undefined>();
  targets.forEach((pick, i) => byUrl.set(pick.url, resolved[i]));

  const withImage = (item: RankedItem): RankedItem =>
    byUrl.has(item.url) && byUrl.get(item.url)
      ? { ...item, imageUrl: byUrl.get(item.url) }
      : item;

  const itemsBySource: Record<string, RankedItem[]> = {};
  for (const [source, items] of Object.entries(report.itemsBySource)) {
    itemsBySource[source] = items.map(withImage);
  }
  return { ...report, itemsBySource, topPicks: report.topPicks.map(withImage) };
}
