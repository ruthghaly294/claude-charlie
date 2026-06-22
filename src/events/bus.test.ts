import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { events, notifications } from "@/db/schema";
import { emit, notify, processEvents, type EventHandlers } from "./bus";
import type { Notifier } from "@/notify/notifier";

function fakeNotifier(name: string, impl?: () => Promise<void>): Notifier {
  return { name, configured: true, send: impl ?? (async () => {}) };
}

describe("emit", () => {
  it("inserts a new event row with status 'new'", () => {
    const db = createDb(":memory:");

    const row = emit(db, "listing.deal", { listingId: "l1" }, { now: () => "2026-01-01T00:00:00.000Z" });

    const stored = db.select().from(events).where(eq(events.id, row.id)).get();
    expect(stored).toEqual({
      id: row.id,
      type: "listing.deal",
      payload: { listingId: "l1" },
      status: "new",
      createdAt: "2026-01-01T00:00:00.000Z",
      processedAt: null,
    });
  });
});

describe("notify", () => {
  it("fans out to configured notifiers and records a notifications row per notifier", async () => {
    const db = createDb(":memory:");
    const a = fakeNotifier("a");
    const b = fakeNotifier("b", async () => {
      throw new Error("boom");
    });

    const results = await notify(db, [a, b], { title: "t", body: "b" }, {
      eventId: "ev1",
      now: () => "2026-01-01T00:00:00.000Z",
    });

    expect(results).toEqual([
      { notifier: "a", ok: true },
      { notifier: "b", ok: false, error: "boom" },
    ]);

    const rows = db.select().from(notifications).all();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.channel === "a")).toMatchObject({
      eventId: "ev1",
      title: "t",
      body: "b",
      status: "sent",
      attempts: 1,
      sentAt: "2026-01-01T00:00:00.000Z",
    });
    expect(rows.find((r) => r.channel === "b")).toMatchObject({
      eventId: "ev1",
      title: "t",
      body: "b",
      status: "failed",
      attempts: 1,
      sentAt: null,
      error: "boom",
    });
  });
});

describe("processEvents", () => {
  it("marks events with no registered handler as processed without notifying", async () => {
    const db = createDb(":memory:");
    emit(db, "unhandled.type", {}, { now: () => "2026-01-01T00:00:00.000Z" });

    const result = await processEvents(db, {}, [], { now: () => "2026-01-01T00:00:01.000Z" });

    expect(result).toEqual({ processed: 1, failed: 0, notified: 0 });
    const row = db.select().from(events).get();
    expect(row?.status).toBe("processed");
    expect(row?.processedAt).toBe("2026-01-01T00:00:01.000Z");
  });

  it("runs the matching handler, notifies, and records the delivery", async () => {
    const db = createDb(":memory:");
    const ev = emit(db, "listing.deal", { listingId: "l1" }, { now: () => "2026-01-01T00:00:00.000Z" });

    const handlers: EventHandlers = {
      "listing.deal": (event) => ({ title: "Deal", body: `deal for ${(event.payload as { listingId: string }).listingId}` }),
    };
    const a = fakeNotifier("a");

    const result = await processEvents(db, handlers, [a], { now: () => "2026-01-01T00:00:01.000Z" });

    expect(result).toEqual({ processed: 1, failed: 0, notified: 1 });
    const row = db.select().from(events).where(eq(events.id, ev.id)).get();
    expect(row?.status).toBe("processed");

    const notif = db.select().from(notifications).all();
    expect(notif).toHaveLength(1);
    expect(notif[0]).toMatchObject({ channel: "a", eventId: ev.id, title: "Deal", body: "deal for l1", status: "sent" });
  });

  it("isolates a throwing handler: marks that event failed without blocking others", async () => {
    const db = createDb(":memory:");
    const bad = emit(db, "bad.type", {}, { now: () => "2026-01-01T00:00:00.000Z" });
    const good = emit(db, "good.type", {}, { now: () => "2026-01-01T00:00:00.500Z" });

    const handlers: EventHandlers = {
      "bad.type": () => {
        throw new Error("kaboom");
      },
      "good.type": () => ({ title: "ok", body: "ok" }),
    };
    const a = fakeNotifier("a");

    const result = await processEvents(db, handlers, [a], { now: () => "2026-01-01T00:00:01.000Z" });

    expect(result).toEqual({ processed: 1, failed: 1, notified: 1 });

    const badRow = db.select().from(events).where(eq(events.id, bad.id)).get();
    expect(badRow?.status).toBe("failed");

    const goodRow = db.select().from(events).where(eq(events.id, good.id)).get();
    expect(goodRow?.status).toBe("processed");
  });

  it("marks an event processed without notifying when the handler returns null", async () => {
    const db = createDb(":memory:");
    emit(db, "quiet.type", {}, { now: () => "2026-01-01T00:00:00.000Z" });

    const handlers: EventHandlers = { "quiet.type": () => null };
    const a = fakeNotifier("a");

    const result = await processEvents(db, handlers, [a], { now: () => "2026-01-01T00:00:01.000Z" });

    expect(result).toEqual({ processed: 1, failed: 0, notified: 0 });
    expect(db.select().from(notifications).all()).toHaveLength(0);
  });

  it("only processes events with status 'new'", async () => {
    const db = createDb(":memory:");
    emit(db, "unhandled.type", {}, { now: () => "2026-01-01T00:00:00.000Z" });
    await processEvents(db, {}, [], { now: () => "2026-01-01T00:00:01.000Z" });

    const second = await processEvents(db, {}, [], { now: () => "2026-01-01T00:00:02.000Z" });

    expect(second).toEqual({ processed: 0, failed: 0, notified: 0 });
  });
});
