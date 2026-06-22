import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import {
  signals,
  entities,
  jobRuns,
  listings,
  events,
  notifications,
  decisions,
  publishedPosts,
  rankings,
} from "@/db/schema";
import { parseConfig } from "@/discovery/config";
import type { Connector, RawSignal } from "@/discovery/types";
import { JOB_KINDS, buildRegistry, type JobContext } from "./registry";
import { emit } from "@/events/bus";
import { _resetOrgIdCache } from "@/publishing/bufferClient";

function fakeConnector(key: string, out: RawSignal[]): Connector {
  return {
    key,
    label: key,
    requiresKeys: [],
    state: () => ({ configured: true }),
    fetch: async () => out,
  };
}

const sig = (over: Partial<RawSignal>): RawSignal => ({
  source: "rss",
  title: "t",
  url: "https://x/1",
  author: "",
  publishedAt: "",
  tags: [],
  raw: "",
  ...over,
});

function ctx(over: Partial<JobContext> = {}): JobContext {
  return {
    db: createDb(":memory:"),
    config: parseConfig({}),
    env: {},
    ...over,
  };
}

describe("buildRegistry", () => {
  it("registers every job kind with a runnable definition", () => {
    const registry = buildRegistry();
    for (const kind of JOB_KINDS) {
      const def = registry[kind];
      expect(def.kind).toBe(kind);
      expect(typeof def.run).toBe("function");
      expect(def.maxAttempts).toBeGreaterThan(0);
      expect(def.backoffBaseMs).toBeGreaterThan(0);
      expect(def.timeoutMs).toBeGreaterThan(0);
    }
  });

  it("merges overrides over the defaults without touching other kinds", () => {
    const customRun = async () => {};
    const registry = buildRegistry({
      digest: { kind: "digest", run: customRun, maxAttempts: 9, backoffBaseMs: 1, timeoutMs: 1 },
    });
    expect(registry.digest.run).toBe(customRun);
    expect(registry.discovery.run).not.toBe(customRun);
  });

  it("the discovery job runs discovery with injected connectors and persists signals", async () => {
    const db = createDb(":memory:");
    const registry = buildRegistry();
    const conns = [
      fakeConnector("rss", [sig({ url: "https://x/job", title: "Radiology job test" })]),
    ];
    const config = { ...parseConfig({}), keywords: ["radiology"], keepThreshold: 0.1 };
    await registry.discovery.run({}, ctx({ db, config, connectors: conns }));
    expect(db.select().from(signals).all().length).toBeGreaterThan(0);
  });

  it("the social-research job runs discovery with injected connectors and persists signals", async () => {
    const db = createDb(":memory:");
    const registry = buildRegistry();
    const conns = [
      fakeConnector("last30days", [
        sig({ source: "last30days", url: "https://x/research", title: "Research signal" }),
      ]),
    ];
    const config = { ...parseConfig({}), keywords: ["radiology"], keepThreshold: 0.1 };
    await registry["social-research"].run({}, ctx({ db, config, connectors: conns }));
    expect(db.select().from(signals).all().length).toBeGreaterThan(0);
  });

  it("the entity-refresh job is a no-op without an ANTHROPIC_API_KEY", async () => {
    const db = createDb(":memory:");
    const registry = buildRegistry();
    await registry["entity-refresh"].run({}, ctx({ db, env: {} }));
    expect(db.select().from(entities).all()).toEqual([]);
  });

  it("the property-scrape job runs detectChanges, marking long-missing listings gone", async () => {
    const db = createDb(":memory:");
    const registry = buildRegistry();
    const t0 = new Date(0).toISOString();

    db.insert(listings)
      .values({
        id: "listing:stale",
        address: "1 Old Rd",
        askingPrice: 100_000,
        firstSeen: t0,
        lastSeen: t0,
      })
      .run();
    for (let i = 1; i <= 3; i++) {
      db.insert(jobRuns)
        .values({
          id: `run-${i}`,
          jobId: "job-1",
          kind: "property-scrape",
          status: "ok",
          startedAt: new Date(i * 60_000).toISOString(),
          finishedAt: new Date(i * 60_000).toISOString(),
        })
        .run();
    }

    // disabled source -> loadSources returns [], so scrapeAllAgents makes no network calls
    const base = parseConfig({});
    const config = {
      ...base,
      property: {
        ...base.property,
        sources: [
          { key: "x", name: "X", sitemapUrl: "https://x/sitemap.xml", include: [], enabled: false },
        ],
      },
    };

    await registry["property-scrape"].run({}, ctx({ db, config }));

    const row = db.select().from(listings).where(eq(listings.id, "listing:stale")).get();
    expect(row?.status).toBe("gone");
    const ev = db.select().from(events).where(eq(events.type, "listing.status_change")).get();
    expect(ev?.payload).toEqual({ listingId: "listing:stale", from: "active", to: "gone" });
  });

  it("the events-process job notifies on a listing.deal event and marks it processed", async () => {
    const db = createDb(":memory:");
    const registry = buildRegistry();

    db.insert(listings)
      .values({
        id: "l1",
        address: "12 Acacia Ave, BT9",
        url: "https://example.com/listing/l1",
        askingPrice: 210_000,
        fairValue: 253_000,
        dealPct: 17,
        firstSeen: "2026-01-01T00:00:00.000Z",
        lastSeen: "2026-01-01T00:00:00.000Z",
      })
      .run();
    const ev = emit(db, "listing.deal", {
      listingId: "l1",
      dealPct: 17,
      fairValue: 253_000,
      askingPrice: 210_000,
    });

    await registry["events-process"].run({}, ctx({ db }));

    const row = db.select().from(events).where(eq(events.id, ev.id)).get();
    expect(row?.status).toBe("processed");

    const notif = db.select().from(notifications).all();
    expect(notif).toHaveLength(1);
    expect(notif[0]).toMatchObject({ channel: "console", eventId: ev.id, title: "Deal alert", status: "sent" });
  });

  it("the digest job sends a daily digest notification", async () => {
    const db = createDb(":memory:");
    const registry = buildRegistry();

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
      })
      .run();

    const config = { ...parseConfig({}), digest: { hourUtc: 0, sections: ["decisions"] } };

    await registry.digest.run({}, ctx({ db, config }));

    const notif = db.select().from(notifications).all();
    expect(notif).toHaveLength(1);
    expect(notif[0]).toMatchObject({ channel: "console", title: "Daily digest", status: "sent" });
    expect(notif[0]?.body).toContain("Publish content on radiology");
  });

  it("the decision-lifecycle job expires open decisions past their ttl", async () => {
    const db = createDb(":memory:");
    const registry = buildRegistry();

    db.insert(decisions)
      .values({
        id: "decision:1",
        lane: "content",
        title: "Publish content on radiology",
        rationale: "because",
        fromInsights: [],
        status: "open",
        createdAt: "2020-01-01T00:00:00.000Z",
      })
      .run();

    await registry["decision-lifecycle"].run({}, ctx({ db }));

    const row = db.select().from(decisions).where(eq(decisions.id, "decision:1")).get();
    expect(row?.status).toBe("expired");
  });

  it("the post-performance job is a no-op without BUFFER_ACCESS_TOKEN", async () => {
    const db = createDb(":memory:");
    const registry = buildRegistry();
    db.insert(publishedPosts)
      .values({
        id: "post:1",
        bufferPostId: "buf1",
        channelId: "c1",
        platform: "x",
        topic: "ai agents",
        itemUrl: "https://example.com/a",
        itemTitle: "Title",
        keyword: "ai agents",
        text: "hi",
        status: "scheduled",
        createdAt: "2026-06-01T00:00:00.000Z",
      })
      .run();

    await registry["post-performance"].run({}, ctx({ db, env: {} }));

    const row = db.select().from(publishedPosts).where(eq(publishedPosts.id, "post:1")).get();
    expect(row?.status).toBe("scheduled");
  });

  it("the post-performance job updates posts and rankings with a configured Buffer client", async () => {
    _resetOrgIdCache();
    const db = createDb(":memory:");
    const registry = buildRegistry();
    db.insert(publishedPosts)
      .values({
        id: "post:1",
        bufferPostId: "buf1",
        channelId: "c1",
        platform: "x",
        topic: "ai agents",
        itemUrl: "https://example.com/a",
        itemTitle: "Title",
        keyword: "ai agents",
        text: "hi",
        status: "scheduled",
        createdAt: "2026-06-01T00:00:00.000Z",
      })
      .run();

    const fetchImpl = (async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { query: string };
      const json = body.query.includes("account {")
        ? { data: { account: { id: "acc1", organizations: [{ id: "org1", name: "Acme" }] } } }
        : {
            data: {
              posts: {
                edges: [
                  {
                    node: {
                      id: "buf1",
                      status: "sent",
                      text: "hello",
                      dueAt: null,
                      sentAt: "2026-06-02T00:00:00.000Z",
                      channelId: "c1",
                      channelService: "x",
                      error: null,
                      metrics: [
                        { type: "engagementRate", name: "Engagement rate", value: 0.08, unit: "percentage" },
                      ],
                      metricsUpdatedAt: "2026-06-03T00:00:00.000Z",
                    },
                  },
                ],
              },
            },
          };
      return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await registry["post-performance"].run(
      {},
      ctx({ db, env: { BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl }),
    );

    const row = db.select().from(publishedPosts).where(eq(publishedPosts.id, "post:1")).get();
    expect(row?.status).toBe("sent");
    expect(row?.metrics).toEqual({ engagementRate: 0.08 });

    const ranking = db.select().from(rankings).where(eq(rankings.keyword, "ai agents")).get();
    expect(ranking?.value).toBe(0.08);
  });
});
