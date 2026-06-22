import { runLast30Days, type ResearchReport } from "@/research/last30days";
import type { TrendTerm } from "./types";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "is", "are",
  "with", "how", "what", "why", "your", "you", "best", "top", "new", "vs",
  "this", "that", "from", "by", "at", "it", "as", "be", "we", "i",
]);

type RawTerm = { term: string; source: string; momentum: number };

function tokenizePhrases(title: string): string[] {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const phrases: string[] = [...words];
  for (let i = 0; i < words.length - 1; i++) phrases.push(`${words[i]} ${words[i + 1]}`);
  return phrases;
}

/**
 * Derive candidate trending terms from a last30days research report by scoring
 * phrases in item titles by frequency × engagement. Pure + testable.
 */
export function extractTrendTerms(report: ResearchReport, max = 20): RawTerm[] {
  const scores = new Map<string, { score: number; source: string }>();
  for (const [source, items] of Object.entries(report.itemsBySource)) {
    for (const item of items) {
      const engagement =
        1 + Object.values(item.engagement).reduce((s, n) => s + n, 0) / 100;
      for (const phrase of tokenizePhrases(item.title)) {
        const weight = engagement * (phrase.includes(" ") ? 2 : 1);
        const cur = scores.get(phrase);
        if (cur) cur.score += weight;
        else scores.set(phrase, { score: weight, source });
      }
    }
  }
  const ranked = [...scores.entries()]
    .filter(([, v]) => v.score > 1)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, max);
  const peak = ranked[0]?.[1].score ?? 1;
  return ranked.map(([term, v]) => ({
    term,
    source: v.source,
    momentum: Math.round((v.score / peak) * 100) / 100,
  }));
}

function mentions(text: string, term: string): boolean {
  return text.toLowerCase().includes(term.toLowerCase());
}

/**
 * Flag which trending terms are gaps: present on the web's radar (and often on
 * competitors) but absent from your own content.
 */
export function computeTrendGaps(
  terms: RawTerm[],
  selfText: string,
  competitors: { domain: string; text: string }[],
): TrendTerm[] {
  return terms.map((t) => {
    const onSelf = mentions(selfText, t.term);
    const onCompetitors = competitors
      .filter((c) => mentions(c.text, t.term))
      .map((c) => c.domain);
    return {
      term: t.term,
      source: t.source,
      momentum: t.momentum,
      onSelf,
      onCompetitors,
      gap: !onSelf && (onCompetitors.length > 0 || t.momentum >= 0.5),
    };
  });
}

export type TrendOptions = {
  env?: Record<string, string | undefined>;
  quick?: boolean;
  runResearch?: (topic: string) => Promise<ResearchReport>;
};

/**
 * Discover trending terms for a site's keywords via the last30days research
 * engine, then mark which are gaps vs. your content and competitors'. The
 * research call is injectable so the audit can run fully offline in tests.
 */
export async function discoverTrendGaps(
  keywords: string[],
  selfText: string,
  competitors: { domain: string; text: string }[],
  opts: TrendOptions = {},
): Promise<TrendTerm[]> {
  if (keywords.length === 0) return [];
  const run = opts.runResearch ?? ((topic: string) => runLast30Days(topic, { quick: opts.quick }, opts.env));
  const topic = keywords.slice(0, 3).join(", ");
  let report: ResearchReport;
  try {
    report = await run(topic);
  } catch {
    return [];
  }
  return computeTrendGaps(extractTrendTerms(report), selfText, competitors);
}
