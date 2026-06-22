import type { CrawlResult } from "./types";

const VALUABLE_SCHEMA = ["FAQPage", "Article", "HowTo", "Product", "QAPage", "Organization"];

function schemaTypes(crawl: CrawlResult): Set<string> {
  const out = new Set<string>();
  for (const p of crawl.pages) for (const t of p.jsonLdTypes) out.add(t.toLowerCase());
  return out;
}

function avgWordCount(crawl: CrawlResult): number {
  const live = crawl.pages.filter((p) => p.status === 200);
  if (live.length === 0) return 0;
  return Math.round(live.reduce((s, p) => s + p.wordCount, 0) / live.length);
}

function host(domain: string): string {
  try {
    return new URL(domain).host.replace(/^www\./, "");
  } catch {
    return domain;
  }
}

/**
 * "Competitors do X, you don't" facts from crawl comparisons: structured-data
 * types they use and you lack, llms.txt adoption, and materially deeper content.
 * Returns plain strings the reasoner turns into competitor-gap recommendations.
 */
export function competitorGaps(self: CrawlResult, competitors: CrawlResult[]): string[] {
  const gaps: string[] = [];
  const selfSchema = schemaTypes(self);
  const selfWords = avgWordCount(self);

  for (const schema of VALUABLE_SCHEMA) {
    if (selfSchema.has(schema.toLowerCase())) continue;
    const users = competitors
      .filter((c) => schemaTypes(c).has(schema.toLowerCase()))
      .map((c) => host(c.domain));
    if (users.length > 0) {
      gaps.push(`Competitors use ${schema} structured data (${users.join(", ")}); you don't`);
    }
  }

  const llmsUsers = competitors.filter((c) => c.signals.hasLlmsTxt).map((c) => host(c.domain));
  if (!self.signals.hasLlmsTxt && llmsUsers.length > 0) {
    gaps.push(`Competitors publish an llms.txt (${llmsUsers.join(", ")}); you don't`);
  }

  for (const c of competitors) {
    const cw = avgWordCount(c);
    if (selfWords > 0 && cw > selfWords * 1.5) {
      gaps.push(
        `${host(c.domain)} averages ${cw} words/page vs your ${selfWords} — their content is materially deeper`,
      );
    }
  }

  return gaps;
}
