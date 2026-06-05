import { and, desc, eq, like, sql, count } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import {
  signals,
  discoveryRuns,
  type Signal,
  type DiscoveryRun,
} from "@/db/schema";
import type { DecodeConfig } from "./config";
import type { ConnectorContext } from "./types";
import { CONNECTORS } from "./connectors";

export const signalsQuerySchema = z.object({
  source: z.string().optional(),
  status: z.enum(["new", "curated", "archived"]).optional(),
  cluster: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type SignalsQuery = z.infer<typeof signalsQuerySchema>;

export function querySignals(
  db: DB,
  params: SignalsQuery,
): { rows: Signal[]; total: number } {
  const conds = [];
  if (params.source) conds.push(eq(signals.source, params.source));
  if (params.status) conds.push(eq(signals.status, params.status));
  if (params.cluster) conds.push(eq(signals.cluster, params.cluster));
  if (params.q) conds.push(like(signals.title, `%${params.q}%`));
  const where = conds.length > 0 ? and(...conds) : undefined;

  const rows = db
    .select()
    .from(signals)
    .where(where)
    .orderBy(desc(signals.capturedAt))
    .limit(params.limit)
    .offset(params.offset)
    .all();

  const totalRow = db.select({ n: count() }).from(signals).where(where).get();
  return { rows, total: totalRow?.n ?? 0 };
}

export type SourceStatus = {
  key: string;
  label: string;
  requiresKeys: string[];
  configured: boolean;
  reason?: string;
  signalCount: number;
};

export function listSources(
  db: DB,
  config: DecodeConfig,
  env: Record<string, string | undefined> = process.env,
): SourceStatus[] {
  const counts = db
    .select({ source: signals.source, n: count() })
    .from(signals)
    .groupBy(signals.source)
    .all();
  const countBy = new Map(counts.map((c) => [c.source, c.n]));

  return CONNECTORS.map((connector) => {
    const ctx: ConnectorContext = {
      keywords: config.keywords,
      businessName: config.businessName,
      config: config.sources[connector.key],
      env,
      fetchImpl: fetch,
    };
    const st = connector.state(ctx);
    // signals are persisted under the connector key (runDiscovery sets source = key)
    return {
      key: connector.key,
      label: connector.label,
      requiresKeys: connector.requiresKeys,
      configured: st.configured,
      reason: st.configured ? undefined : st.reason,
      signalCount: countBy.get(connector.key) ?? 0,
    };
  });
}

export function getLatestRun(db: DB): DiscoveryRun | undefined {
  return db
    .select()
    .from(discoveryRuns)
    .orderBy(desc(discoveryRuns.startedAt))
    .limit(1)
    .get();
}

export function distinctClusters(db: DB): string[] {
  const rows = db
    .selectDistinct({ c: signals.cluster })
    .from(signals)
    .where(sql`${signals.cluster} is not null`)
    .all();
  return rows.map((r) => r.c).filter((c): c is string => !!c);
}
