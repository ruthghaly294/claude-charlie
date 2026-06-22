import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import Database from "better-sqlite3";
import { createDb, ensureSchema } from "./client";
import {
  signals,
  discoveryRuns,
  entities,
  jobs,
  jobRuns,
  events,
  decisions,
  notifications,
  musicTracks,
} from "./schema";

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

  it("stores signal engagement fields (points, comments, views, socialScore, authorKey)", () => {
    const db = createDb(":memory:");
    db.insert(signals)
      .values({
        id: "s2",
        source: "reddit",
        title: "Engagement",
        url: "https://x/2",
        urlHash: "hash2",
        capturedAt: new Date().toISOString(),
        points: 120,
        comments: 34,
        views: 500,
        socialScore: 0.87,
        authorKey: "reddit:some_user",
      })
      .run();
    const row = db.select().from(signals).where(eq(signals.id, "s2")).get();
    expect(row?.points).toBe(120);
    expect(row?.comments).toBe(34);
    expect(row?.views).toBe(500);
    expect(row?.socialScore).toBe(0.87);
    expect(row?.authorKey).toBe("reddit:some_user");
  });

  it("creates a jobs table and round-trips a pending job with a json payload", () => {
    const db = createDb(":memory:");
    const now = new Date().toISOString();
    db.insert(jobs)
      .values({
        id: "j1",
        kind: "discovery",
        payload: { foo: "bar" },
        runAt: now,
        createdAt: now,
      })
      .run();
    const row = db.select().from(jobs).where(eq(jobs.id, "j1")).get();
    expect(row?.kind).toBe("discovery");
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(0);
    expect(row?.maxAttempts).toBe(3);
    expect(row?.payload).toEqual({ foo: "bar" });
  });

  it("creates a job_runs table and round-trips an attempt log row", () => {
    const db = createDb(":memory:");
    const now = new Date().toISOString();
    db.insert(jobRuns)
      .values({
        id: "jr1",
        jobId: "j1",
        kind: "discovery",
        attempt: 1,
        status: "ok",
        startedAt: now,
        finishedAt: now,
        durationMs: 42,
      })
      .run();
    const row = db.select().from(jobRuns).where(eq(jobRuns.id, "jr1")).get();
    expect(row?.jobId).toBe("j1");
    expect(row?.status).toBe("ok");
    expect(row?.durationMs).toBe(42);
  });

  it("creates an events table and round-trips a new event with a json payload", () => {
    const db = createDb(":memory:");
    const now = new Date().toISOString();
    db.insert(events)
      .values({
        id: "ev1",
        type: "listing.price_drop",
        payload: { listingId: "l1", pct: 5 },
        createdAt: now,
      })
      .run();
    const row = db.select().from(events).where(eq(events.id, "ev1")).get();
    expect(row?.type).toBe("listing.price_drop");
    expect(row?.status).toBe("new");
    expect(row?.payload).toEqual({ listingId: "l1", pct: 5 });
  });

  it("creates an entities table and round-trips a seed entity", () => {
    const db = createDb(":memory:");
    db.insert(entities)
      .values({
        id: "e1",
        keyword: "web scraping",
        kind: "subreddit",
        value: "webscraping",
        weight: 1,
        status: "active",
        source: "seed",
        createdAt: new Date().toISOString(),
      })
      .run();
    const row = db.select().from(entities).where(eq(entities.id, "e1")).get();
    expect(row?.keyword).toBe("web scraping");
    expect(row?.kind).toBe("subreddit");
    expect(row?.value).toBe("webscraping");
    expect(row?.status).toBe("active");
    expect(row?.source).toBe("seed");
  });

  it("allows decisions.status values added for the lifecycle (expired/reopened) and updatedAt/expiresAt", () => {
    const db = createDb(":memory:");
    const now = new Date().toISOString();
    db.insert(decisions)
      .values({
        id: "decision:x",
        title: "Do the thing",
        rationale: "because",
        fromInsights: ["insight:x"],
        status: "reopened",
        updatedAt: now,
        expiresAt: now,
        createdAt: now,
      })
      .run();
    const row = db.select().from(decisions).where(eq(decisions.id, "decision:x")).get();
    expect(row?.status).toBe("reopened");
    expect(row?.updatedAt).toBe(now);
    expect(row?.expiresAt).toBe(now);

    db.update(decisions).set({ status: "expired" }).where(eq(decisions.id, "decision:x")).run();
    expect(db.select().from(decisions).where(eq(decisions.id, "decision:x")).get()?.status).toBe(
      "expired",
    );
  });

  it("creates a notifications table and round-trips a delivery record", () => {
    const db = createDb(":memory:");
    const now = new Date().toISOString();
    db.insert(notifications)
      .values({
        id: "n1",
        channel: "console",
        eventId: "ev1",
        title: "Deal alert",
        body: "12 Acacia Ave — £210k, 17% under fair value",
        status: "sent",
        attempts: 1,
        sentAt: now,
        createdAt: now,
      })
      .run();
    const row = db.select().from(notifications).where(eq(notifications.id, "n1")).get();
    expect(row?.channel).toBe("console");
    expect(row?.eventId).toBe("ev1");
    expect(row?.status).toBe("sent");
    expect(row?.attempts).toBe(1);
    expect(row?.sentAt).toBe(now);
  });

  it("round-trips a music track including nativeSoundId", () => {
    const db = createDb(":memory:");
    const now = new Date().toISOString();
    db.insert(musicTracks)
      .values({
        id: "m1",
        topic: "us oil drops",
        trendTitle: "tense build",
        nativeSoundId: "tiktok:7401234567890",
        provider: "tiktok",
        createdAt: now,
      })
      .run();
    const row = db.select().from(musicTracks).where(eq(musicTracks.id, "m1")).get();
    expect(row?.nativeSoundId).toBe("tiktok:7401234567890");
  });

  it("migrates an older music_tracks table missing native_sound_id", () => {
    const sqlite = new Database(":memory:");
    // Simulate a DB created before the native_sound_id column existed.
    sqlite.exec(`
      CREATE TABLE music_tracks (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        trend_title TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    ensureSchema(sqlite);
    const cols = new Set(
      sqlite
        .prepare("PRAGMA table_info(music_tracks)")
        .all()
        .map((r) => (r as { name: string }).name),
    );
    expect(cols.has("native_sound_id")).toBe(true);
  });
});
