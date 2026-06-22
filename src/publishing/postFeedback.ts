import { and, eq, isNotNull, ne } from "drizzle-orm";
import type { DB } from "@/db/client";
import { publishedPosts, type Ranking } from "@/db/schema";
import { runFeedback, type Metric } from "@/discovery/feedback";
import type { BufferClient, PostMetric } from "./bufferClient";

export type CollectPostPerformanceOptions = {
  now?: () => string;
};

export type CollectPostPerformanceResult = {
  updated: number;
  feedback: Ranking[];
};

function flattenMetrics(metrics: PostMetric[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of metrics) out[m.type] = m.value;
  return out;
}

/** Per-post engagement score, used to feed runFeedback's per-keyword averages. */
function engagementValue(flat: Record<string, number>): number {
  if (flat.engagementRate !== undefined) return flat.engagementRate;
  const reach = flat.reach ?? 0;
  if (reach <= 0) return 0;
  return ((flat.reactions ?? 0) + (flat.clicks ?? 0)) / reach;
}

/**
 * Pull current status/metrics from Buffer for every tracked post that hasn't
 * reached a terminal "sent" state, then aggregate engagement by the
 * originating keyword and feed it into runFeedback (the rankings table that
 * curate/rank consult).
 */
export async function collectPostPerformance(
  db: DB,
  client: BufferClient,
  orgId: string,
  opts: CollectPostPerformanceOptions = {},
): Promise<CollectPostPerformanceResult> {
  const now = opts.now ?? (() => new Date().toISOString());

  const pending = db
    .select()
    .from(publishedPosts)
    .where(and(isNotNull(publishedPosts.bufferPostId), ne(publishedPosts.status, "sent")))
    .all();

  if (pending.length === 0) return { updated: 0, feedback: [] };

  const posts = await client.listPosts(orgId, {});
  const byId = new Map(posts.map((p) => [p.id, p]));

  let updated = 0;
  const byKeyword = new Map<string, number[]>();

  for (const row of pending) {
    const post = byId.get(row.bufferPostId!);
    if (!post) continue;

    const flat = flattenMetrics(post.metrics);
    db.update(publishedPosts)
      .set({ status: post.status, metrics: flat, lastMetricsAt: now() })
      .where(eq(publishedPosts.id, row.id))
      .run();
    updated++;

    if (post.status === "sent" && row.keyword) {
      const values = byKeyword.get(row.keyword) ?? [];
      values.push(engagementValue(flat));
      byKeyword.set(row.keyword, values);
    }
  }

  const metrics: Metric[] = [...byKeyword.entries()].map(([keyword, values]) => ({
    keyword,
    value: values.reduce((sum, v) => sum + v, 0) / values.length,
  }));

  const feedback = runFeedback(db, metrics);
  return { updated, feedback };
}
