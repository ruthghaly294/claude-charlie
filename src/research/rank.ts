import { scoreSignal } from "@/discovery/scoring";
import { socialPercentiles } from "@/discovery/socialScore";
import { mergeClusters } from "@/discovery/clusterMerge";
import type { RankWeights } from "@/discovery/research";
import type { ResearchItem, ResearchReport } from "./last30days";

export type { RankWeights };

export type RankedItem = ResearchItem & { source: string; score: number; cluster: string };

export type RankedReport = Omit<ResearchReport, "itemsBySource"> & {
  itemsBySource: Record<string, RankedItem[]>;
  topPicks: RankedItem[];
};

export type RankReportOptions = {
  keywords: string[];
  multipliers: Record<string, number>;
  weights: RankWeights;
  halfLifeDays: number;
  topN: number;
  now?: () => string;
  /** optional semantic relevance per item url (cosine, [0,1]); blended into keyword relevance. */
  semanticScores?: Record<string, number>;
  /** weight of the semantic signal within relevance (0 = keyword only, 1 = semantic only). */
  semanticWeight?: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** exp(-ageDays/halfLifeDays); missing/invalid publishedAt is treated as neutral (0.5). */
function recencyScore(publishedAt: string | undefined, nowMs: number, halfLifeDays: number): number {
  if (!publishedAt) return 0.5;
  const publishedMs = Date.parse(publishedAt);
  if (Number.isNaN(publishedMs)) return 0.5;
  const ageDays = Math.max(0, (nowMs - publishedMs) / MS_PER_DAY);
  return Math.exp(-ageDays / halfLifeDays);
}

/**
 * Rank every item across `report.itemsBySource` by a weighted composite of
 * relevance (keyword/multiplier match), engagement (per-source percentile),
 * and recency (half-life decay), then collapse near-duplicate titles across
 * sources to their highest-scoring representative. Returns the report with
 * `itemsBySource` re-sorted/filtered to survivors plus a global `topPicks`.
 */
export function rankReport(report: ResearchReport, opts: RankReportOptions): RankedReport {
  const now = opts.now ?? (() => new Date().toISOString());
  const nowMs = Date.parse(now());

  const flat: { source: string; item: ResearchItem }[] = [];
  for (const [source, items] of Object.entries(report.itemsBySource)) {
    for (const item of items) flat.push({ source, item });
  }

  const relevance = flat.map(({ source, item }) =>
    scoreSignal(`${item.title} ${item.snippet}`, opts.keywords, opts.multipliers, source),
  );

  // Blend in semantic similarity (cosine vs the topic) when provided, so a pick
  // that's clearly on-topic but keyword-light still ranks. Falls back to the raw
  // keyword score for any item without a semantic score.
  const semanticWeight = opts.semanticScores ? (opts.semanticWeight ?? 0.5) : 0;
  const relevanceScore = (i: number): number => {
    const kw = relevance[i]!.score;
    const sem = opts.semanticScores?.[flat[i]!.item.url];
    if (sem === undefined || semanticWeight <= 0) return kw;
    return (1 - semanticWeight) * kw + semanticWeight * sem;
  };

  const engagement = socialPercentiles(
    flat.map(({ source, item }) => ({
      source,
      points: Object.values(item.engagement).reduce((sum, n) => sum + n, 0),
    })),
  );

  const recency = flat.map(({ item }) => recencyScore(item.publishedAt, nowMs, opts.halfLifeDays));

  const scores = flat.map(
    (_, i) =>
      relevanceScore(i) * opts.weights.relevance +
      engagement[i]! * opts.weights.engagement +
      recency[i]! * opts.weights.recency,
  );

  // Each item starts in its own singleton cluster; mergeClusters only unions
  // clusters whose titles are near-duplicates (jaccard >= threshold).
  const clusterable = flat.map(({ source }, i) => ({
    id: `${source}:${i}`,
    title: flat[i]!.item.title,
    cluster: `${source}:${i}`,
  }));
  const merged = mergeClusters(clusterable);

  const bestInCluster = new Map<string, number>();
  for (let i = 0; i < merged.length; i++) {
    const cluster = merged[i]!.cluster;
    const current = bestInCluster.get(cluster);
    if (current === undefined || scores[i]! > scores[current]!) {
      bestInCluster.set(cluster, i);
    }
  }
  const survivors = new Set(bestInCluster.values());

  const itemsBySource: Record<string, RankedItem[]> = {};
  for (const source of Object.keys(report.itemsBySource)) itemsBySource[source] = [];

  const rankedItems: RankedItem[] = [];
  flat.forEach(({ source, item }, i) => {
    if (!survivors.has(i)) return;
    const ranked: RankedItem = {
      ...item,
      source,
      score: Math.round(scores[i]! * 1000) / 1000,
      cluster: relevance[i]!.cluster,
    };
    itemsBySource[source]!.push(ranked);
    rankedItems.push(ranked);
  });

  for (const source of Object.keys(itemsBySource)) {
    itemsBySource[source]!.sort((a, b) => b.score - a.score);
  }

  const topPicks = [...rankedItems].sort((a, b) => b.score - a.score).slice(0, opts.topN);

  return { ...report, itemsBySource, topPicks };
}
