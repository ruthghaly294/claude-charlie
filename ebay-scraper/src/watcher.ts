import {
  comparable,
  saleObservation,
  marketSummary,
  potentialDeal,
  researchText,
  type MarketProfile,
} from "./market.js";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { listingSchema, type Listing } from "./contract.js";
import { ScrapeError } from "./errors.js";

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
});
export function alertText(watch: Watch, listing: Listing): string {
  const amount = watch.mode === "sold" ? listing.sale_price : listing.price;
  const price = amount
    ? `${amount.currency} ${amount.value.toFixed(2)}`
    : "Price undisclosed";
  return `${watch.mode === "sold" ? "Newly sold" : "New listing"}: ${listing.title}\n${price}${listing.ended_date ? ` · ended ${listing.ended_date}` : ""}\n${listing.url}`;
}
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
    const job = this.get(id);
    if (!job) return;
    const rows = results.filter(
      (r) =>
        (job.mode !== "sold" || r.is_sold === true) &&
        (!job.marketProfile || comparable(job.marketProfile, r)),
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
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
        const inserted = this.db
          .prepare("INSERT OR IGNORE INTO seen(job,item,payload) VALUES(?,?,?)")
          .run(id, r.item_id, JSON.stringify(r));
        if (!inserted.changes)
          this.db
            .prepare("UPDATE seen SET payload=? WHERE job=? AND item=?")
            .run(JSON.stringify(r), id, r.item_id);
        let dealQueued = false;
        if (job.mode === "active" && job.marketProfile) {
          const stats = this.market(job.marketProfile, 90, now);
          const deal = potentialDeal(r, stats);
          if (deal) {
            this.enqueue(
              id,
              `deal:${r.item_id}`,
              `POTENTIAL BELOW-MARKET LISTING (${deal.discountPercent}% below median)\n${r.title}\nPrice + advertised delivery: £${deal.totalPrice.toFixed(2)}\nSold median £${stats.median?.toFixed(2)} from ${stats.count} comparable disclosed sales (90-day sample).\n${r.url}\n${job.baselined ? "Observed in current scan." : "Observed in initial scan, not newly listed since monitoring started."} Verify condition and authenticity.`,
            );
            dealQueued = true;
          }
        }
        if (job.baselined && inserted.changes && !dealQueued)
          this.enqueue(id, r.item_id, alertText(job, r));
      }
      this.db
        .prepare(
          "UPDATE watches SET baseline=1,last_success=?,last_error=NULL,result_count=?,next_run=? WHERE id=?",
        )
        .run(now, rows.length, startedAt + job.intervalMinutes * 60000, id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  failure(id: string, code: string, now: number): void {
    const job = this.get(id);
    if (!job) return;
    if (job.lastError !== code)
      this.db
        .prepare("INSERT OR IGNORE INTO outbox(job,item,payload) VALUES(?,?,?)")
        .run(
          id,
          `error:${code}:${now}`,
          `Search needs attention: ${job.name}\n${code}${code === "UPSTREAM_AUTH_REQUIRED" ? " — sign into the server eBay browser again." : " — the search will retry automatically."}`,
        );
    this.db
      .prepare("UPDATE watches SET last_error=?,next_run=? WHERE id=?")
      .run(code, now + job.intervalMinutes * 60000, id);
  }
  pending(now: number): { id: number; payload: string; attempts: number }[] {
    return this.db
      .prepare(
        "SELECT id,payload,attempts FROM outbox WHERE delivered=0 AND next_attempt<=? ORDER BY id LIMIT 20",
      )
      .all(now)
      .map((r) => pendingSchema.parse(r));
  }
  enqueue(job: string, key: string, text: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO outbox(job,item,payload) VALUES(?,?,?)")
      .run(job, key, text);
  }
  delivered(id: number): void {
    this.db.prepare("UPDATE outbox SET delivered=1 WHERE id=?").run(id);
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
  send: (text: string) => Promise<void>,
  clock: () => number = Date.now,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  for (const job of store.list()) {
    if (shouldStop()) break;
    if (job.nextRun > clock()) continue;
    try {
      const startedAt = clock();
      store.record(job.id, await search(job), clock(), startedAt);
    } catch (error) {
      store.failure(
        job.id,
        error instanceof ScrapeError ? error.code : "SEARCH_FAILED",
        clock(),
      );
    }
  }
  for (const pending of store.pending(clock())) {
    if (shouldStop()) break;
    try {
      await send(pending.payload);
      store.delivered(pending.id);
    } catch {
      store.retry(pending.id, pending.attempts, clock());
    }
  }
}
