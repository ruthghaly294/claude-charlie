import { z } from "zod";

/**
 * A raw signal as emitted by a connector, before dedup/scoring/persistence.
 * Connectors MUST return data that parses against this schema — anything that
 * doesn't is dropped (and counted) rather than crashing a run.
 */
export const rawSignalSchema = z.object({
  source: z.string().min(1),
  title: z.string().min(1),
  url: z.string().default(""),
  author: z.string().default(""),
  publishedAt: z.string().default(""),
  tags: z.array(z.string()).default([]),
  raw: z.string().default(""),
  /** engagement metrics, where the source provides them (used by Phase 3 social scoring) */
  points: z.number().optional(),
  comments: z.number().optional(),
  views: z.number().optional(),
});

export type RawSignal = z.infer<typeof rawSignalSchema>;

export type ConnectorContext = {
  /** keyword list used to build queries for search-style sources */
  keywords: string[];
  /** business name, used as a query fallback */
  businessName: string;
  /** per-connector config from decode.config.yml (.sources.<key>); array or object */
  config: unknown;
  /** environment (for API keys); defaults to process.env */
  env: Record<string, string | undefined>;
  /** injectable fetch (tests pass a mock); defaults to global fetch */
  fetchImpl: typeof fetch;
  /** signal for cancellation/timeouts at the run level */
  signal?: AbortSignal;
};

export type ConnectorState =
  | { configured: true }
  | { configured: false; reason: string };

export interface Connector {
  /** stable key, e.g. "rss" — matches decode.config.yml sources.<key> */
  key: string;
  /** human label for the dashboard */
  label: string;
  /** whether this connector needs API keys (for UI hints) */
  requiresKeys: string[];
  /** is this connector usable given config + env? */
  state(ctx: ConnectorContext): ConnectorState;
  /** fetch and return validated raw signals; may throw on hard failure */
  fetch(ctx: ConnectorContext): Promise<RawSignal[]>;
  /**
   * Optional cheap pre-flight check (e.g. probing for a 401 from a stale
   * token). When present and it reports `configured: false`, the source
   * runner records the connector as "skipped" for this run without it
   * counting against the circuit breaker.
   */
  healthCheck?(ctx: ConnectorContext): Promise<ConnectorState>;
}

/** Parse an array of unknown records into RawSignals, dropping invalid ones. */
export function parseRawSignals(source: string, items: unknown[]): RawSignal[] {
  const out: RawSignal[] = [];
  for (const item of items) {
    const parsed = rawSignalSchema.safeParse(item);
    if (parsed.success) out.push({ ...parsed.data, source });
  }
  return out;
}
