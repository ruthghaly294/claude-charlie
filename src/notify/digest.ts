import { desc, eq, inArray, ne } from "drizzle-orm";
import type { DB } from "@/db/client";
import { decisions, insights, listings, notifications, sourceHealth } from "@/db/schema";
import type { DecodeConfig } from "@/discovery/config";
import { notify } from "@/events/bus";
import type { Notifier } from "./notifier";

export const DIGEST_TITLE = "Daily digest";

export type DigestSummary = {
  sent: boolean;
  sections: string[];
};

export type DigestOptions = {
  notifiers?: Notifier[];
  now?: () => string;
};

function dealsSection(db: DB): string | null {
  const rows = db
    .select()
    .from(listings)
    .where(inArray(listings.status, ["active", "sstc"]))
    .orderBy(desc(listings.dealScore))
    .limit(5)
    .all()
    .filter((l) => l.dealPct !== null && l.dealPct > 0);
  if (rows.length === 0) return null;

  const lines = rows.map(
    (l) =>
      `- ${l.address || l.id}: £${Math.round(l.askingPrice).toLocaleString("en-GB")} (${l.dealPct}% under fair value)`,
  );
  return ["## Deals", ...lines].join("\n");
}

function insightsSection(db: DB): string | null {
  const rows = db.select().from(insights).orderBy(desc(insights.createdAt)).limit(5).all();
  if (rows.length === 0) return null;

  const lines = rows.map((i) => `- [${i.importance}] ${i.cluster}: ${i.trend}`);
  return ["## Insights", ...lines].join("\n");
}

function decisionsSection(db: DB): string | null {
  const rows = db
    .select()
    .from(decisions)
    .where(eq(decisions.status, "open"))
    .orderBy(desc(decisions.priority))
    .limit(5)
    .all();
  if (rows.length === 0) return null;

  const lines = rows.map((d) => `- [${d.lane}] ${d.title} (priority ${d.priority})`);
  return ["## Decisions", ...lines].join("\n");
}

function healthSection(db: DB): string {
  const rows = db.select().from(sourceHealth).where(ne(sourceHealth.state, "closed")).all();
  if (rows.length === 0) return "## Health\nAll sources healthy.";

  const lines = rows.map((s) => `- ${s.source}: ${s.state}${s.lastError ? ` (${s.lastError})` : ""}`);
  return ["## Health", ...lines].join("\n");
}

const SECTION_BUILDERS: Record<string, (db: DB) => string | null> = {
  deals: dealsSection,
  insights: insightsSection,
  decisions: decisionsSection,
  health: healthSection,
};

/**
 * Build + send the daily digest (deals, insights, open decisions, source
 * health), once per UTC calendar day and not before `config.digest.hourUtc`.
 * Idempotency is tracked via the most recent `notifications` row titled
 * `DIGEST_TITLE`. A no-op (`{sent: false, sections: []}`) if it's too early
 * or a digest already went out today.
 */
export async function runDigest(
  db: DB,
  config: DecodeConfig,
  opts: DigestOptions = {},
): Promise<DigestSummary> {
  const { notifiers = [], now = () => new Date().toISOString() } = opts;
  const at = now();
  const today = at.slice(0, 10);
  const hour = new Date(at).getUTCHours();

  if (hour < config.digest.hourUtc) return { sent: false, sections: [] };

  const last = db
    .select()
    .from(notifications)
    .where(eq(notifications.title, DIGEST_TITLE))
    .orderBy(desc(notifications.createdAt))
    .limit(1)
    .get();
  if (last && last.createdAt.slice(0, 10) === today) return { sent: false, sections: [] };

  const built = config.digest.sections
    .map((name) => ({ name, markdown: SECTION_BUILDERS[name]?.(db) ?? null }))
    .filter((s): s is { name: string; markdown: string } => s.markdown !== null);

  const body =
    built.length > 0 ? built.map((s) => s.markdown).join("\n\n") : "Nothing to report today.";

  await notify(db, notifiers, { title: DIGEST_TITLE, body }, { now });

  return { sent: true, sections: built.map((s) => s.name) };
}
