import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { carSchema, type Car } from "./listing.js";
import type { Observation } from "./market.js";

const rowSchema = z.object({
  payload: z.string(),
  first_seen: z.number(),
  last_seen: z.number(),
});

export class CarStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS cars(source TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,PRIMARY KEY(source,id));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    const columns = this.db.prepare("PRAGMA table_info(cars)").all();
    for (const column of ["alerted", "checked", "rejected"])
      if (!columns.some((c) => c["name"] === column))
        this.db.exec(
          `ALTER TABLE cars ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`,
        );
  }
  // Used Cars NI only discloses some write-offs in the seller's description.
  unchecked(limit: number): Car[] {
    return this.db
      .prepare(
        "SELECT payload FROM cars WHERE source='Used Cars NI' AND checked=0 ORDER BY first_seen DESC LIMIT ?",
      )
      .all(limit)
      .map((row) => carSchema.parse(JSON.parse(String(row["payload"]))));
  }
  checked(car: Car, rejected: boolean): void {
    this.db
      .prepare("UPDATE cars SET checked=1,rejected=? WHERE source=? AND id=?")
      .run(rejected ? 1 : 0, car.source, car.id);
  }
  unalerted(cars: Car[], since: number): Car[] {
    const check = this.db.prepare(
      "SELECT 1 FROM cars WHERE source=? AND id=? AND alerted=0 AND rejected=0 AND (checked=1 OR source<>'Used Cars NI') AND first_seen>=?",
    );
    return cars.filter((car) => check.get(car.source, car.id, since));
  }
  markAlerted(cars: Car[]): void {
    const mark = this.db.prepare(
      "UPDATE cars SET alerted=1 WHERE source=? AND id=?",
    );
    for (const car of cars) mark.run(car.source, car.id);
  }
  record(cars: Car[], now: number): Car[] {
    const exists = this.db.prepare(
      "SELECT 1 FROM cars WHERE source=? AND id=?",
    );
    const upsert = this.db.prepare(
      "INSERT INTO cars(source,id,payload,first_seen,last_seen) VALUES(?,?,?,?,?) ON CONFLICT(source,id) DO UPDATE SET payload=excluded.payload,last_seen=excluded.last_seen",
    );
    return cars.filter((car) => {
      const fresh = !exists.get(car.source, car.id);
      upsert.run(car.source, car.id, JSON.stringify(car), now, now);
      return fresh;
    });
  }
  firstSeen(car: Car): number | undefined {
    const row = this.db
      .prepare("SELECT first_seen FROM cars WHERE source=? AND id=?")
      .get(car.source, car.id);
    return typeof row?.["first_seen"] === "number"
      ? row["first_seen"]
      : undefined;
  }
  // Cars missing from the latest complete scan have gone; age them at removal.
  observations(scanAt: number | undefined, now: number): Observation[] {
    const start = this.db
      .prepare("SELECT min(first_seen) AS start FROM cars")
      .get()?.["start"];
    return this.db
      .prepare(
        "SELECT payload,first_seen,last_seen FROM cars WHERE rejected=0 AND (checked=1 OR source<>'Used Cars NI')",
      )
      .all()
      .map((raw) => {
        const row = rowSchema.parse(raw);
        const gone = scanAt !== undefined && row.last_seen < scanAt;
        const car = carSchema.parse(JSON.parse(row.payload));
        return {
          car,
          at: new Date(gone ? row.last_seen : now),
          gone,
          listed: car.listedOn
            ? Date.parse(car.listedOn)
            : row.first_seen > Number(start)
              ? row.first_seen
              : null,
        };
      });
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
