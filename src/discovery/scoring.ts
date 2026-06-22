import { createHash } from "node:crypto";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|igshid$|mc_eid$|ref$|ref_src$)/i;

/**
 * Normalize a URL so trivially-different links to the same resource collapse to
 * one dedup key: force https, drop a leading `www.`, strip the fragment and
 * common tracking params (utm_*, fbclid, igshid…), and remove a trailing slash.
 * Malformed input falls back to a trimmed/lowercased string.
 */
export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) {
      if (TRACKING_PARAM.test(p)) u.searchParams.delete(p);
    }
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/$/, "");
    const query = u.searchParams.toString();
    return `https://${host}${path}${query ? `?${query}` : ""}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Stable dedup key: sha1 of the canonicalized url, falling back to the title. */
export function hashKey(url: string, title: string): string {
  const basis = url && url.trim() ? canonicalizeUrl(url) : title.trim();
  return createHash("sha1").update(basis).digest("hex");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const boundaryCache = new Map<string, RegExp>();

/**
 * Whole-word/phrase match: the keyword must be bounded by non-alphanumeric
 * characters (or string edges) on both sides, so "python" matches "python
 * programming" but not "pythonic". Multi-word phrases match as a unit. Cached
 * per keyword since the same keyword set is reused across every item in a run.
 */
function matchesKeyword(haystack: string, keyword: string): boolean {
  let re = boundaryCache.get(keyword);
  if (!re) {
    re = new RegExp(`(?<![a-z0-9])${escapeRegExp(keyword)}(?![a-z0-9])`, "i");
    boundaryCache.set(keyword, re);
  }
  return re.test(haystack);
}

export type ScoreResult = { score: number; cluster: string };

/**
 * Number of matched-keyword "weight" at which a signal reaches full relevance.
 * Scoring divides by this constant rather than by the keyword-list length, so
 * adding more keywords to broaden coverage never suppresses a signal's score:
 * one solid match ≈ 0.5, two ≈ 1.0, regardless of how many keywords exist.
 */
export const SATURATION = 2;

/**
 * Relevance score = sum of matched keyword multipliers / SATURATION, clamped to
 * [0,1] — independent of the keyword-list length (see SATURATION). Cluster =
 * first matching keyword (slugified), else the `fallbackCluster` (callers pass
 * the signal's source) so broad/keyword-light runs still cluster by origin
 * rather than collapsing to "unclustered". With no keywords configured,
 * everything scores 1.0 (keep-all). `multipliers` (from the Feedback stage)
 * default to 1.0 per keyword.
 */
export function scoreSignal(
  text: string,
  keywords: string[],
  multipliers: Record<string, number> = {},
  fallbackCluster = "unclustered",
): ScoreResult {
  const haystack = text.toLowerCase();
  if (keywords.length === 0) return { score: 1, cluster: fallbackCluster };

  let sum = 0;
  let cluster: string | undefined;
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim();
    if (!k) continue;
    if (matchesKeyword(haystack, k)) {
      sum += multipliers[k] ?? 1;
      cluster ??= slugify(kw);
    }
  }
  const score = Math.min(1, sum / SATURATION);
  return { score: Math.round(score * 100) / 100, cluster: cluster ?? fallbackCluster };
}
