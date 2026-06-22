export type EngagementInput = {
  source: string;
  points?: number | null;
  comments?: number | null;
  views?: number | null;
};

/** Log-scaled total engagement (points + comments + views, negatives treated as zero). */
export function engagementMagnitude(s: EngagementInput): number {
  const sum =
    Math.max(0, s.points ?? 0) + Math.max(0, s.comments ?? 0) + Math.max(0, s.views ?? 0);
  return Math.log1p(sum);
}

/**
 * Per-source percentile rank (0..1) of each item's engagement magnitude.
 * Items with no engagement data at all, items in a singleton group, and
 * items in a group where everyone has identical engagement all default to 1
 * (no penalty) — social ranking only ever pulls a score *down* relative to
 * its source's more-engaged peers, never up.
 */
export function socialPercentiles(items: EngagementInput[]): number[] {
  const magnitudes: (number | null)[] = items.map((it) =>
    it.points == null && it.comments == null && it.views == null
      ? null
      : engagementMagnitude(it),
  );

  const result = new Array<number>(items.length).fill(1);

  const bySource = new Map<string, number[]>();
  items.forEach((it, i) => {
    if (magnitudes[i] == null) return;
    const indices = bySource.get(it.source) ?? [];
    indices.push(i);
    bySource.set(it.source, indices);
  });

  for (const indices of bySource.values()) {
    const uniqueMagnitudes = [...new Set(indices.map((i) => magnitudes[i]!))].sort(
      (a, b) => a - b,
    );
    if (uniqueMagnitudes.length <= 1) continue; // no spread → leave at default 1

    const percentileOf = new Map<number, number>();
    uniqueMagnitudes.forEach((m, rank) =>
      percentileOf.set(m, rank / (uniqueMagnitudes.length - 1)),
    );
    for (const i of indices) result[i] = percentileOf.get(magnitudes[i]!)!;
  }

  return result;
}

/** finalScore = keywordScore * (0.5 + 0.5 * socialPercentile) — a 0.5x-1x multiplier. */
export function applySocialBoost(keywordScore: number, socialPercentile: number): number {
  return keywordScore * (0.5 + 0.5 * socialPercentile);
}
