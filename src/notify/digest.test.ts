import { describe, it, expect } from "vitest";
import { createDb, type DB } from "@/db/client";
import { decisions, insights, listings, sourceHealth } from "@/db/schema";
import { parseConfig, type DecodeConfig } from "@/discovery/config";
import type { Notifier, NotifyMessage } from "./notifier";
import { runDigest, DIGEST_TITLE } from "./digest";

function cfg(over: Partial<DecodeConfig> = {}): DecodeConfig {
  return { ...parseConfig({}), ...over };
}

function fakeNotifier(name: string): Notifier & { sent: NotifyMessage[] } {
  const sent: NotifyMessage[] = [];
  return {
    name,
    configured: true,
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

function seedDecision(db: DB, over: Partial<typeof decisions.$inferInsert> = {}) {
  db.insert(decisions)
    .values({
      id: "decision:1",
      lane: "content",
      title: "Publish content on radiology",
      priority: 10,
      rationale: "because",
      fromInsights: [],
      status: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      ...over,
    })
    .run();
}

function seedInsight(db: DB, over: Partial<typeof insights.$inferInsert> = {}) {
  db.insert(insights)
    .values({
      id: "insight:radiology",
      cluster: "radiology",
      trend: "radiology trend is rising",
      importance: "high",
      createdAt: "2026-01-01T00:00:00.000Z",
      ...over,
    })
    .run();
}

function seedListing(db: DB, over: Partial<typeof listings.$inferInsert> = {}) {
  db.insert(listings)
    .values({
      id: "l1",
      address: "12 Acacia Ave, BT9",
      askingPrice: 210_000,
      status: "active",
      dealPct: 17,
      dealScore: 50,
      firstSeen: "2026-01-01T00:00:00.000Z",
      lastSeen: "2026-01-01T00:00:00.000Z",
      ...over,
    })
    .run();
}

describe("runDigest", () => {
  it("does nothing before digest.hourUtc", async () => {
    const db = createDb(":memory:");
    const notifier = fakeNotifier("console");

    const sum = await runDigest(db, cfg({ digest: { hourUtc: 7, sections: ["deals"] } }), {
      notifiers: [notifier],
      now: () => "2026-01-10T06:00:00.000Z",
    });

    expect(sum).toEqual({ sent: false, sections: [] });
    expect(notifier.sent).toHaveLength(0);
  });

  it("sends a digest covering every configured section at/after hourUtc", async () => {
    const db = createDb(":memory:");
    seedDecision(db);
    seedInsight(db);
    seedListing(db);

    const notifier = fakeNotifier("console");
    const sum = await runDigest(db, cfg(), {
      notifiers: [notifier],
      now: () => "2026-01-10T07:00:00.000Z",
    });

    expect(sum.sent).toBe(true);
    expect(sum.sections).toEqual(["deals", "insights", "decisions", "health"]);
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]?.title).toBe(DIGEST_TITLE);

    const body = notifier.sent[0]!.body;
    expect(body).toContain("12 Acacia Ave");
    expect(body).toContain("17% under fair value");
    expect(body).toContain("radiology trend is rising");
    expect(body).toContain("Publish content on radiology");
    expect(body).toContain("All sources healthy.");
  });

  it("omits sections with no content", async () => {
    const db = createDb(":memory:");
    const notifier = fakeNotifier("console");

    const sum = await runDigest(db, cfg(), {
      notifiers: [notifier],
      now: () => "2026-01-10T07:00:00.000Z",
    });

    expect(sum.sections).toEqual(["health"]);
    const body = notifier.sent[0]!.body;
    expect(body).not.toContain("## Deals");
    expect(body).not.toContain("## Insights");
    expect(body).not.toContain("## Decisions");
    expect(body).toContain("All sources healthy.");
  });

  it("reports unhealthy sources in the health section", async () => {
    const db = createDb(":memory:");
    db.insert(sourceHealth)
      .values({
        source: "reddit",
        state: "open",
        lastError: "timeout",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })
      .run();

    const notifier = fakeNotifier("console");
    await runDigest(db, cfg(), {
      notifiers: [notifier],
      now: () => "2026-01-10T07:00:00.000Z",
    });

    const body = notifier.sent[0]!.body;
    expect(body).toContain("reddit: open");
    expect(body).toContain("timeout");
    expect(body).not.toContain("All sources healthy.");
  });

  it("does not send a second digest on the same UTC day", async () => {
    const db = createDb(":memory:");
    const notifier = fakeNotifier("console");

    await runDigest(db, cfg(), { notifiers: [notifier], now: () => "2026-01-10T07:00:00.000Z" });
    const second = await runDigest(db, cfg(), {
      notifiers: [notifier],
      now: () => "2026-01-10T20:00:00.000Z",
    });

    expect(second).toEqual({ sent: false, sections: [] });
    expect(notifier.sent).toHaveLength(1);
  });
});
