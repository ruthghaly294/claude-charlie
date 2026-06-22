/** Lowercase alphanumeric words of length >= 4 — short connector words drop out naturally. */
export function salientTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4),
  );
}

/** Intersection-over-union of two token sets; 0 for two empty sets. */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export type ClusterableSignal = {
  id: string;
  title: string;
  cluster: string | null;
};

/**
 * Cross-source cluster merge: when two signals' title tokens overlap at or
 * above `threshold` (Jaccard, default 0.5), their clusters are merged —
 * transitively, via union-find — into the lexicographically-smaller cluster
 * name. Pairs already sharing a cluster are skipped. Returns new objects;
 * `cluster: null` is treated as "unclustered".
 */
export function mergeClusters<T extends ClusterableSignal>(items: T[], threshold = 0.5): T[] {
  const tokens = items.map((it) => salientTokens(it.title));
  const clusterOf = items.map((it) => it.cluster ?? "unclustered");

  const parent = new Map<string, string>();
  function find(x: string): string {
    const p = parent.get(x);
    if (p === undefined || p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  }
  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const [keep, drop] = ra < rb ? [ra, rb] : [rb, ra];
    parent.set(drop, keep);
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (find(clusterOf[i]!) === find(clusterOf[j]!)) continue;
      if (jaccardSimilarity(tokens[i]!, tokens[j]!) >= threshold) {
        union(clusterOf[i]!, clusterOf[j]!);
      }
    }
  }

  return items.map((it, i) => ({ ...it, cluster: find(clusterOf[i]!) }));
}

export type AuthorCappable = {
  id: string;
  authorKey?: string | null;
  score?: number | null;
};

/**
 * Keep at most `cap` (default 3) signals per `authorKey`, dropping the
 * lowest-scored excess. Signals without an authorKey are never capped.
 * Preserves the original relative order of kept items.
 */
export function applyAuthorCap<T extends AuthorCappable>(items: T[], cap = 3): T[] {
  const byAuthor = new Map<string, T[]>();
  for (const it of items) {
    if (!it.authorKey) continue;
    const group = byAuthor.get(it.authorKey) ?? [];
    group.push(it);
    byAuthor.set(it.authorKey, group);
  }

  const drop = new Set<T>();
  for (const group of byAuthor.values()) {
    if (group.length <= cap) continue;
    const sorted = [...group].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    for (const it of sorted.slice(cap)) drop.add(it);
  }

  return items.filter((it) => !drop.has(it));
}
