import { createHash } from "node:crypto";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/** Stable dedup key: sha1 of the url, falling back to the title. */
export function hashKey(url: string, title: string): string {
  const basis = url && url.trim() ? url.trim() : title.trim();
  return createHash("sha1").update(basis).digest("hex");
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
    if (haystack.includes(k)) {
      sum += multipliers[k] ?? 1;
      cluster ??= slugify(kw);
    }
  }
  const score = Math.min(1, sum / SATURATION);
  return { score: Math.round(score * 100) / 100, cluster: cluster ?? fallbackCluster };
}
