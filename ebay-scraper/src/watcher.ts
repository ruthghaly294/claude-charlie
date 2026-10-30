import { freshListing } from "./alert-freshness.js";
import {
  comparable,
  saleObservation,
  marketSummary,
  potentialDeal,
  researchText,
  type MarketProfile,
} from "./market.js";
import {
  telegramOptionsSchema,
  type TelegramOptions,
} from "./telegram-options.js";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { listingSchema, type Listing } from "./contract.js";
import { PartialScanError, ScrapeError } from "./errors.js";

import { watchSchema, type WatchInput } from "./watch-config.js";
export { watchSchema } from "./watch-config.js";
export type Watch = WatchInput & {
  id: string;
  baselined: boolean;
  nextRun: number;
  lastSuccess: number | null;
  lastError: string | null;
  resultCount: number;
};
const rowSchema = z.object({
  id: z.string(),
  input: z.string(),
  baseline: z.number(),
  next_run: z.number(),
  last_success: z.number().nullable(),
  last_error: z.string().nullable(),
  result_count: z.number(),
});
function decode(row: unknown): Watch {
  const r = rowSchema.parse(row);
  return {
    ...watchSchema.parse(JSON.parse(r.input)),
    id: r.id,
    baselined: r.baseline === 1,
    nextRun: r.next_run,
    lastSuccess: r.last_success,
    lastError: r.last_error,
    resultCount: r.result_count,
  };
}
const pendingSchema = z.object({
  id: z.number(),
  payload: z.string(),
  attempts: z.number(),
  media: z
    .string()
    .nullable()
    .transform((value): TelegramOptions | undefined =>
      value === null
        ? undefined
        : telegramOptionsSchema.parse(JSON.parse(value)),
    ),
});
export function listingTimeText(listing: Listing, now: number): string {
  if (!listing.listed_at || Date.parse(listing.listed_at) > now)
    return "Listing time unavailable — seller upload time could not be verified.";
  const minutes = Math.floor((now - Date.parse(listing.listed_at)) / 60000);
  const age =
    minutes < 1
      ? "less than a minute ago"
      : `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const exact = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(listing.listed_at));
  return `Listed ${exact} · ${age} (at alert)`;
}
export function alertText(
  watch: Watch,
  listing: Listing,
  now = Date.now(),
): string {
  const amount = watch.mode === "sold" ? listing.sale_price : listing.price;
  const price = amount
    ? `${amount.currency} ${amount.value.toFixed(2)}`
    : "Price undisclosed";
  const gap =
    watch.lastSuccess !== null &&
    now - watch.lastSuccess > watch.intervalMinutes * 120000;
  const detected = `${listingTimeText(listing, now)}\nDetected ${listing.detected_at ?? new Date(now).toISOString()}${gap ? " after a monitoring gap; it may have been listed earlier." : ""}`;
  if (watch.provider === "facebook")
    return `New Facebook Marketplace listing: ${listing.title}\n${listing.price ? `Asking price ${listing.price.raw}` : "Asking price undisclosed"}\n${listing.location ?? "Location undisclosed"}\n${detected}\n${listing.url}`;
  return `${watch.mode === "sold" ? "Newly detected sale" : "Newly detected listing"}: ${listing.title}\n${price}${listing.ended_date ? ` · ended ${listing.ended_date}` : ""}\n${detected}\n${listing.url}`;
}
const researchCompleteNextRun = Date.UTC(9999, 11, 31);
export class WatchStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS watches(id TEXT PRIMARY KEY,input TEXT NOT NULL,baseline INTEGER NOT NULL DEFAULT 0,next_run INTEGER NOT NULL DEFAULT 0,last_success INTEGER,last_error TEXT,result_count INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS seen(job TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,item TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(job,item));
   CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY,job TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,item TEXT NOT NULL,payload TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,UNIQUE(job,item));
 CREATE TABLE IF NOT EXISTS observations(profile TEXT NOT NULL,item TEXT NOT NULL,price REAL NOT NULL,sold_at INTEGER NOT NULL,PRIMARY KEY(profile,item));
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    const columns = this.db.prepare("PRAGMA table_info(outbox)").all();
    if (!columns.some((column) => column["name"] === "media"))
      this.db.exec("ALTER TABLE outbox ADD COLUMN media TEXT");
    // Carry the most recent legacy warning into the service-wide cooldown.
    if (this.setting("healthAlertAt") === undefined) {
      const legacy = this.db
        .prepare(
          "SELECT item FROM outbox WHERE item LIKE 'error:%' ORDER BY id DESC LIMIT 1",
        )
        .get();
      if (typeof legacy?.["item"] === "string") {
        const at = Number(legacy["item"].split(":").at(-1));
        if (Number.isFinite(at)) this.setSetting("healthAlertAt", String(at));
      }
    }
    // Withdraw legacy retry warnings; keep listing alerts and delivered history.
    this.db.exec(
      "DELETE FROM outbox WHERE delivered=0 AND item LIKE 'error:%'",
    );
  }
  create(input: unknown): Watch {
    const parsed = watchSchema.parse(input);
    if (this.list().length >= 20) throw new Error("Maximum 20 searches");
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO watches(id,input) VALUES(?,?)")
      .run(id, JSON.stringify(parsed));
    return this.get(id)!;
  }
  get(id: string): Watch | undefined {
    const r = this.db.prepare("SELECT * FROM watches WHERE id=?").get(id);
    return r ? decode(r) : undefined;
  }
  list(): Watch[] {
    return this.db
      .prepare("SELECT * FROM watches ORDER BY rowid")
      .all()
      .map(decode);
  }
  remove(id: string): boolean {
    return (
      this.db.prepare("DELETE FROM watches WHERE id=?").run(id).changes !== 0
    );
  }
  record(
    id: string,
    results: readonly Listing[],
    now: number,
    startedAt = now,
  ): void {
    this.recordResults(id, results, now, startedAt, true);
  }
  recordResolvedListings(
    id: string,
    results: readonly Listing[],
    now: number,
  ): void {
    if (
      !this.get(id)?.baselined &&
      this.maxNewListingAgeMinutes() === undefined
    )
      return;
    this.recordResults(id, results, now, now, false);
  }
  private recordResults(
    id: string,
    results: readonly Listing[],
    now: number,
    startedAt: number,
    completeScan: boolean,
  ): void {
    const job = this.get(id);
    if (!job) return;
    const maxAge =
      job.mode === "active" && !job.once
        ? this.maxNewListingAgeMinutes()
        : undefined;
    const rows = results.filter(
      (r) =>
        (job.mode !== "sold" || r.is_sold === true) &&
        (!job.marketProfile || comparable(job.marketProfile, r)),
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // Keep a fixed start boundary: successful empty scans must not move it
      // forward and discard listings that Facebook surfaces late.
      const facebookStart = Number(
        this.setting(`facebookBaselineAt:${id}`) ??
          (job.baselined ? now - 86400000 : now),
      );
      if (
        job.provider === "facebook" &&
        !this.setting(`facebookBaselineAt:${id}`)
      )
        this.setSetting(`facebookBaselineAt:${id}`, String(facebookStart));
      // Active rows cannot add sold observations: use one consistent snapshot.
      const stats =
        job.mode === "active" && job.marketProfile
          ? this.market(job.marketProfile, 90, now)
          : undefined;
      for (const r of rows) {
        if (job.mode === "sold" && job.marketProfile) {
          const sale = saleObservation(r, now);
          if (sale)
            this.db
              .prepare(
                "INSERT OR REPLACE INTO observations(profile,item,price,sold_at) VALUES(?,?,?,?)",
              )
              .run(job.marketProfile, sale.itemId, sale.price, sale.soldAt);
        }
        // Undated listings get a bounded verification window, never a guessed age.
        if (
          maxAge !== undefined &&
          (!r.listed_at || Date.parse(r.listed_at) > now)
        ) {
          const key = `unverifiedSince:${id}:${r.item_id}`;
          const first = Number(
            this.setting(key) ??
              (r.detected_at ? Date.parse(r.detected_at) : now),
          );
          this.setSetting(key, String(first));
          if (now - first <= maxAge * 60000) continue;
        } else if (job.provider === "facebook" && job.baselined && !r.listed_at)
          continue;
        const inserted = this.db
          .prepare("INSERT OR IGNORE INTO seen(job,item,payload) VALUES(?,?,?)")
          .run(id, r.item_id, JSON.stringify(r));
        if (!inserted.changes) {
          const previous = this.db
            .prepare("SELECT payload FROM seen WHERE job=? AND item=?")
            .get(id, r.item_id);
          const old = listingSchema.parse(
            JSON.parse(String(previous!["payload"])),
          );
          const refreshed = {
            ...r,
            listed_at: r.listed_at ?? old.listed_at,
            detected_at: old.detected_at ?? r.detected_at,
          };
          this.db
            .prepare("UPDATE seen SET payload=? WHERE job=? AND item=?")
            .run(JSON.stringify(refreshed), id, r.item_id);
        }
        if (maxAge !== undefined && !freshListing(r, now, maxAge)) continue;
        // Facebook can surface old recommendations on any scan. Unseen does
        // not mean newly listed. Require a verified time within the recent
        // monitoring window, even after a long outage.
        if (
          maxAge === undefined &&
          job.provider === "facebook" &&
          (!r.listed_at ||
            Date.parse(r.listed_at) > now ||
            Date.parse(r.listed_at) < Math.max(now - 86400000, facebookStart))
        )
          continue;
        let dealQueued = false;
        if (stats) {
          const deal = potentialDeal(r, stats);
          if (deal) {
            this.enqueue(
              id,
              `deal:${r.item_id}`,
              `POTENTIAL BELOW-MARKET LISTING (${deal.discountPercent}% below median)\n${r.title}\nPrice + advertised delivery: £${deal.totalPrice.toFixed(2)}\nSold median £${stats.median?.toFixed(2)} from ${stats.count} comparable disclosed sales (90-day sample).\n${listingTimeText(r, now)}\n${r.url}\n${job.baselined ? "Observed in current scan." : "Observed in initial scan, not newly listed since monitoring started."} Verify condition and authenticity.`,
              { image: r.image, url: r.url },
            );
            dealQueued = true;
          }
        }
        if (
          (job.baselined || maxAge !== undefined) &&
          inserted.changes &&
          !dealQueued &&
          job.notifyNew !== false
        )
          this.enqueue(id, r.item_id, alertText(job, r, now), {
            image: r.image,
            url: r.url,
          });
      }
      if (completeScan) {
        this.db
          .prepare(
            "UPDATE watches SET baseline=1,last_success=?,last_error=NULL,result_count=?,next_run=? WHERE id=?",
          )
          .run(
            now,
            rows.length,
            job.once
              ? researchCompleteNextRun
              : startedAt + job.intervalMinutes * 60000,
            id,
          );
        this.db
          .prepare("DELETE FROM settings WHERE key IN (?,?)")
          .run(`failureSince:${id}`, `failureCount:${id}`);
        this.db
          .prepare(
            "DELETE FROM outbox WHERE job=? AND delivered=0 AND item LIKE 'health:%'",
          )
          .run(id);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  failure(id: string, code: string, now: number): void {
    const job = this.get(id);
    if (!job) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const sinceKey = `failureSince:${id}`;
      const countKey = `failureCount:${id}`;
      const since = Number(this.setting(sinceKey) ?? now);
      const count = Math.min(30, Number(this.setting(countKey) ?? 0) + 1);
      this.setSetting(sinceKey, String(since));
      this.setSetting(countKey, String(count));
      const lastAlert = this.setting("healthAlertAt");
      const needsAttention =
        code === "UPSTREAM_AUTH_REQUIRED" || now - since >= 30 * 60000;
      // One service-wide health warning per day, even through restarts,
      // alternating errors, and brief recoveries. Listing alerts are independent.
      if (
        needsAttention &&
        !this.db
          .prepare(
            "SELECT 1 FROM outbox WHERE delivered=0 AND item LIKE 'health:%' LIMIT 1",
          )
          .get() &&
        (lastAlert === undefined || now - Number(lastAlert) >= 86400000)
      ) {
        const site =
          job.provider === "facebook" ? "Facebook Marketplace" : "eBay";
        const platform = job.provider === "facebook" ? "Facebook" : "eBay";
        this.enqueue(
          id,
          `health:${now}`,
          `${site} monitoring needs attention: ${job.name}\n${code === "UPSTREAM_AUTH_REQUIRED" ? `${platform} requires sign-in; sign into the server ${platform} browser again.` : code === "UPSTREAM_TEMPORARY_ERROR" ? "eBay is returning temporary error pages for this search. Automatic retries are continuing." : "This search has been failing for at least 30 minutes. Automatic retries are continuing."} Use /status for all searches. Health notifications are limited to one per day.`,
        );
        this.setSetting("healthAlertAt", String(now));
      }
      const interval = job.intervalMinutes * 60000;
      const retryCap = /PARTIAL|INCOMPLETE|PAGINATION/.test(code)
        ? interval
        : code === "UPSTREAM_TEMPORARY_ERROR"
          ? 5 * 60000
          : 30 * 60000;
      const delay = Math.max(
        interval,
        Math.min(retryCap, interval * 2 ** (count - 1)),
      );
      this.db
        .prepare("UPDATE watches SET last_error=?,next_run=? WHERE id=?")
        .run(code, now + delay, id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  maxNewListingAgeMinutes(): number | undefined {
    const raw = this.setting("newListingMaxAgeMinutes");
    if (raw === undefined) return undefined;
    return z.coerce.number().int().min(1).max(1440).parse(raw);
  }
  payloadForDelivery(id: number, payload: string, now: number): string | null {
    const queued = this.db
      .prepare("SELECT job,item FROM outbox WHERE id=? AND delivered=0")
      .get(id);
    if (
      !queued ||
      typeof queued["job"] !== "string" ||
      typeof queued["item"] !== "string"
    )
      return null;
    const item = /^(?:deal:)?(\d+)$/.exec(queued["item"])?.[1];
    const job = this.get(queued["job"]);
    if (!item || job?.mode !== "active") return payload;
    const maxAge = this.maxNewListingAgeMinutes();
    if (maxAge === undefined) return payload;
    const stored = this.db
      .prepare("SELECT payload FROM seen WHERE job=? AND item=?")
      .get(job.id, item);
    const listing = stored
      ? listingSchema.parse(JSON.parse(String(stored["payload"])))
      : undefined;
    if (!listing || !freshListing(listing, now, maxAge)) {
      this.db.prepare("DELETE FROM outbox WHERE id=? AND delivered=0").run(id);
      return null;
    }
    return payload.replace(
      /^(?:Listed |Listing time unavailable)[^\n]*$/m,
      listingTimeText(listing, now),
    );
  }

  pending(now: number): z.infer<typeof pendingSchema>[] {
    return this.db
      .prepare(
        "SELECT id,payload,attempts,media FROM outbox WHERE delivered=0 AND next_attempt<=? ORDER BY id LIMIT 20",
      )
      .all(now)
      .map((r) => pendingSchema.parse(r));
  }
  enqueue(
    job: string,
    key: string,
    text: string,
    media?: TelegramOptions,
  ): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO outbox(job,item,payload,media) VALUES(?,?,?,?)",
      )
      .run(job, key, text, media ? JSON.stringify(media) : null);
  }
  isPending(id: number): boolean {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM outbox WHERE id=? AND delivered=0")
        .get(id),
    );
  }
  delivered(id: number, now = Date.now()): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT item FROM outbox WHERE id=? AND delivered=0")
        .get(id);
      this.db.prepare("UPDATE outbox SET delivered=1 WHERE id=?").run(id);
      if (
        typeof row?.["item"] === "string" &&
        row["item"].startsWith("health:")
      )
        this.setSetting("healthAlertAt", String(now));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  retry(id: number, attempts: number, now: number): void {
    this.db
      .prepare(
        "UPDATE outbox SET attempts=attempts+1,next_attempt=? WHERE id=?",
      )
      .run(now + Math.min(1800000, 60000 * 2 ** Math.min(attempts, 5)), id);
  }
  status(): {
    queued: number;
    delivered: number;
    monitoringConfirmedAt: string | null;
  } {
    const row = this.db
      .prepare(
        "SELECT SUM(CASE WHEN delivered=0 THEN 1 ELSE 0 END) AS queued,SUM(delivered) AS delivered FROM outbox",
      )
      .get();
    return {
      monitoringConfirmedAt: this.setting("activationSent") ?? null,
      queued: Number(row?.["queued"] ?? 0),
      delivered: Number(row?.["delivered"] ?? 0),
    };
  }
  market(profile: MarketProfile, days: number, now = Date.now()) {
    const rows = this.db
      .prepare(
        "SELECT item AS itemId,price,sold_at AS soldAt FROM observations WHERE profile=?",
      )
      .all(profile)
      .map((row) =>
        z
          .object({ itemId: z.string(), price: z.number(), soldAt: z.number() })
          .parse(row),
      );
    const comparableRows = rows.filter((row) => {
      const seen = this.db
        .prepare("SELECT payload FROM seen WHERE item=? LIMIT 1")
        .get(row.itemId);
      if (typeof seen?.["payload"] !== "string") return false;
      const parsed = listingSchema.safeParse(JSON.parse(seen["payload"]));
      return parsed.success && comparable(profile, parsed.data);
    });
    return marketSummary(comparableRows, days, now);
  }
  research(profile: MarketProfile, days = 90): string {
    return researchText(profile, this.market(profile, days));
  }
  hasSeen(id: string, item: string): boolean {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM seen WHERE job=? AND item=?")
        .get(id, item),
    );
  }
  listings(id: string): Listing[] {
    return this.db
      .prepare("SELECT payload FROM seen WHERE job=?")
      .all(id)
      .map((row) => listingSchema.parse(JSON.parse(String(row["payload"]))));
  }
  configure(id: string, input: WatchInput): void {
    const job = this.get(id);
    if (!job) return;
    const config = watchSchema.parse(input);
    const next =
      config.once && job.baselined
        ? researchCompleteNextRun
        : job.once && !config.once
          ? 0
          : job.nextRun;
    this.db
      .prepare("UPDATE watches SET input=?,next_run=? WHERE id=?")
      .run(JSON.stringify(config), next, id);
  }
  link(id: string, watchlistId: string, researchRequest?: string): void {
    const job = this.get(id);
    if (!job) return;
    const {
      id: _id,
      baselined: _baseline,
      nextRun: _next,
      lastSuccess: _success,
      lastError: _error,
      resultCount: _count,
      ...input
    } = job;
    this.db.prepare("UPDATE watches SET input=? WHERE id=?").run(
      JSON.stringify(
        watchSchema.parse({
          ...input,
          watchlistId,
          ...(researchRequest && job.mode === "sold"
            ? { researchRequest }
            : {}),
          freeShipping: false,
          once: false,
          notifyNew: job.mode === "active",
        }),
      ),
      id,
    );
  }
  setting(key: string): string | undefined {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(key);
    return typeof row?.["value"] === "string" ? row["value"] : undefined;
  }
  setSetting(key: string, value: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)")
      .run(key, value);
  }
  close(): void {
    this.db.close();
  }
}
export async function runWatchCycle(
  store: WatchStore,
  search: (watch: Watch) => Promise<readonly Listing[]>,
  send: (text: string, media?: TelegramOptions) => Promise<void>,
  clock: () => number = Date.now,
  shouldStop: () => boolean = () => false,
  options: { include?: (job: Watch) => boolean; deliver?: boolean } = {},
): Promise<void> {
  if (options.deliver !== false)
    await deliverWatchAlerts(store, send, clock, shouldStop);
  for (const saved of store
    .list()
    .filter(options.include ?? (() => true))
    .sort(
      (a, b) =>
        (a.mode === "active" ? (a.once ? 1 : 0) : 2) -
        (b.mode === "active" ? (b.once ? 1 : 0) : 2),
    )) {
    if (shouldStop()) break;
    const job = store.get(saved.id);
    if (!job || job.nextRun > clock()) continue;
    try {
      const startedAt = clock();
      store.record(job.id, await search(job), clock(), startedAt);
    } catch (error) {
      if (error instanceof PartialScanError)
        store.recordResolvedListings(job.id, error.results, clock());
      store.failure(
        job.id,
        error instanceof ScrapeError ? error.code : "SEARCH_FAILED",
        clock(),
      );
    }
    if (options.deliver !== false)
      await deliverWatchAlerts(store, send, clock, shouldStop);
  }
  if (options.deliver !== false)
    await deliverWatchAlerts(store, send, clock, shouldStop);
}
// Concurrent search lanes share one outbox; serializing delivery stops two
// lanes sending the same pending alert before either marks it delivered.
const deliveries = new WeakMap<WatchStore, Promise<void>>();
export function deliverWatchAlerts(
  store: WatchStore,
  send: (text: string, media?: TelegramOptions) => Promise<void>,
  clock: () => number,
  shouldStop: () => boolean,
): Promise<void> {
  const next = (deliveries.get(store) ?? Promise.resolve()).then(() =>
    deliverPending(store, send, clock, shouldStop),
  );
  deliveries.set(
    store,
    next.catch(() => {}),
  );
  return next;
}
async function deliverPending(
  store: WatchStore,
  send: (text: string, media?: TelegramOptions) => Promise<void>,
  clock: () => number,
  shouldStop: () => boolean,
): Promise<void> {
  for (const pending of store.pending(clock())) {
    if (shouldStop()) break;
    if (!store.isPending(pending.id)) continue;
    try {
      const payload = store.payloadForDelivery(
        pending.id,
        pending.payload,
        clock(),
      );
      if (payload === null) continue;
      await send(payload, pending.media);
      store.delivered(pending.id, clock());
    } catch {
      store.retry(pending.id, pending.attempts, clock());
    }
  }
}
