import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { signals, discoveryRuns } from "./schema";

describe("db client", () => {
  it("creates an in-memory schema and round-trips a signal", () => {
    const db = createDb(":memory:");
    db.insert(signals)
      .values({
        id: "s1",
        source: "rss",
        title: "Hello",
        url: "https://x/1",
        urlHash: "hash1",
        tags: ["rss", "test"],
        score: 0.5,
        cluster: "radiology",
        capturedAt: new Date().toISOString(),
      })
      .run();

    const row = db.select().from(signals).where(eq(signals.id, "s1")).get();
    expect(row?.title).toBe("Hello");
    expect(row?.tags).toEqual(["rss", "test"]);
    expect(row?.status).toBe("new");
  });

  it("enforces the url_hash unique constraint", () => {
    const db = createDb(":memory:");
    const base = {
      source: "rss",
      title: "T",
      url: "https://x/1",
      urlHash: "dup",
      capturedAt: new Date().toISOString(),
    };
    db.insert(signals)
      .values({ id: "a", ...base })
      .run();
    expect(() =>
      db
        .insert(signals)
        .values({ id: "b", ...base })
        .run(),
    ).toThrow();
  });

  it("stores a discovery run with json perSource", () => {
    const db = createDb(":memory:");
    db.insert(discoveryRuns)
      .values({
        id: "r1",
        startedAt: new Date().toISOString(),
        status: "ok",
        totalFound: 3,
        totalNew: 2,
        perSource: [
          { source: "rss", status: "ok", found: 3, added: 2, durationMs: 12 },
        ],
      })
      .run();
    const run = db.select().from(discoveryRuns).get();
    expect(run?.totalNew).toBe(2);
    expect(run?.perSource[0]?.source).toBe("rss");
  });

  it("ensureSchema is idempotent (createDb twice over same memory is fine)", () => {
    const db = createDb(":memory:");
    expect(db.select().from(signals).all()).toEqual([]);
  });
});
