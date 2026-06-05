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
 * Relevance score = sum of matched keyword multipliers / total keywords,
 * clamped to [0,1]. Cluster = first matching keyword (slugified).
 * With no keywords configured, everything scores 1.0 (keep-all).
 * `multipliers` (from the Feedback stage) default to 1.0 per keyword.
 */
export function scoreSignal(
  text: string,
  keywords: string[],
  multipliers: Record<string, number> = {},
): ScoreResult {
  const haystack = text.toLowerCase();
  const total = keywords.length;
  if (total === 0) return { score: 1, cluster: "unclustered" };

  let sum = 0;
  let cluster = "unclustered";
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim();
    if (!k) continue;
    if (haystack.includes(k)) {
      sum += multipliers[k] ?? 1;
      if (cluster === "unclustered") cluster = slugify(kw);
    }
  }
  const score = Math.min(1, sum / total);
  return { score: Math.round(score * 100) / 100, cluster };
}
