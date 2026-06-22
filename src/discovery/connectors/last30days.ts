import { existsSync } from "node:fs";
import { z } from "zod";
import type { Connector, ConnectorContext, RawSignal } from "../types";
import {
  runLast30Days,
  DEFAULT_SCRIPT_PATH,
  type ResearchItem,
} from "@/research/last30days";

const cfgSchema = z.object({
  enabled: z.boolean().default(false),
  topic: z.string().optional(),
});

function sumEngagement(engagement: Record<string, number>): number {
  return Object.values(engagement).reduce((sum, n) => sum + n, 0);
}

function toRawSignal(subSource: string, item: ResearchItem): RawSignal {
  const points = sumEngagement(item.engagement);
  return {
    source: "last30days",
    title: item.title,
    url: item.url,
    author: item.author ?? "",
    publishedAt: item.publishedAt ?? "",
    tags: ["last30days", subSource],
    raw: item.snippet,
    points: points || undefined,
    authorKey: item.author ? `last30days:${item.author}` : undefined,
  };
}

/**
 * Connector wrapping the manual research panel's `runLast30Days` pipeline so
 * its richer multi-source discovery feeds the same signals/insights/decisions
 * pipeline as the automated connectors. `run` and `scriptExists` are injected
 * for testing; the defaults call the real CLI and check the real script path.
 */
export function createLast30DaysConnector(
  run: typeof runLast30Days = runLast30Days,
  scriptExists: () => boolean = () =>
    existsSync(process.env.LAST30DAYS_SCRIPT ?? DEFAULT_SCRIPT_PATH),
): Connector {
  return {
    key: "last30days",
    label: "Last 30 Days (multi-source research)",
    requiresKeys: [],

    state(ctx: ConnectorContext) {
      const c = cfgSchema.safeParse(ctx.config ?? {});
      if (!c.success || !c.data.enabled) {
        return { configured: false, reason: "disabled in config" };
      }
      if (!scriptExists()) {
        return { configured: false, reason: "last30days script not found" };
      }
      return { configured: true };
    },

    async fetch(ctx: ConnectorContext): Promise<RawSignal[]> {
      const c = cfgSchema.safeParse(ctx.config ?? {});
      const cfg = c.success ? c.data : { enabled: false, topic: undefined };
      const topic = cfg.topic?.trim() || ctx.businessName;
      const report = await run(topic, { quick: true }, ctx.env);

      const out: RawSignal[] = [];
      for (const [subSource, items] of Object.entries(report.itemsBySource)) {
        for (const item of items) out.push(toRawSignal(subSource, item));
      }
      return out;
    },
  };
}
