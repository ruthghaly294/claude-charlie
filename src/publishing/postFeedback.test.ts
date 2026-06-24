import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type DB } from "@/db/client";
import { publishedPosts, rankings } from "@/db/schema";
import type { BufferClient, BufferPost } from "@/publishing/bufferClient";
import { collectPostPerformance } from "./postFeedback";

function seedPost(db: DB, overrides: Partial<typeof publishedPosts.$inferInsert>): void {
  db.insert(publishedPosts)
    .values({
      id: "post:1",
      bufferPostId: null,
      channelId: "c1",
      platform: "x",
      topic: "ai agents",
      itemUrl: "https://example.com/a",
      itemTitle: "Title",
      keyword: null,
      text: "hi",
      status: "scheduled",
      createdAt: "2026-06-01T00:00:00.000Z",
      ...overrides,
    })
    .run();
}

function bufferPost(overrides: Partial<BufferPost>): BufferPost {
  return {
    id: "buf1",
    status: "sent",
    text: "hello",
    dueAt: null,
    sentAt: "2026-06-02T00:00:00.000Z",
    channelId: "c1",
    channelService: "x",
    error: null,
    metrics: [],
    metricsUpdatedAt: null,
    imageUrl: null,
    imageUrls: [],
    ...overrides,
  };
}

function fakeClient(posts: BufferPost[]): BufferClient & { listPosts: ReturnType<typeof vi.fn> } {
  const listPosts = vi.fn().mockResolvedValue(posts);
  return {
    configured: true,
    getAccount: async () => {
      throw new Error("not implemented");
    },
    listChannels: async () => {
      throw new Error("not implemented");
    },
    listPosts,
    createPost: async () => {
      throw new Error("not implemented");
    },
    editPost: async () => {
      throw new Error("not implemented");
    },
    deletePost: async () => {
      throw new Error("not implemented");
    },
    retryPost: async () => {
      throw new Error("not implemented");
    },
    getPost: async () => {
      throw new Error("not implemented");
    },
  };
}

describe("collectPostPerformance", () => {
  it("updates a published_posts row's status, metrics, and lastMetricsAt from Buffer", async () => {
    const db = createDb(":memory:");
    seedPost(db, { id: "post:1", bufferPostId: "buf1", keyword: "ai agents" });

    const client = fakeClient([
      bufferPost({
        id: "buf1",
        status: "sent",
        metrics: [{ type: "engagementRate", name: "Engagement rate", value: 0.08, unit: "percentage" }],
        metricsUpdatedAt: "2026-06-03T00:00:00.000Z",
      }),
    ]);

    const result = await collectPostPerformance(db, client, "org1", {
      now: () => "2026-06-14T00:00:00.000Z",
    });

    expect(result.updated).toBe(1);
    expect(client.listPosts).toHaveBeenCalledWith("org1", {});

    const row = db.select().from(publishedPosts).where(eq(publishedPosts.id, "post:1")).get();
    expect(row?.status).toBe("sent");
    expect(row?.metrics).toEqual({ engagementRate: 0.08 });
    expect(row?.lastMetricsAt).toBe("2026-06-14T00:00:00.000Z");
  });

  it("feeds the per-keyword engagementRate into runFeedback/rankings", async () => {
    const db = createDb(":memory:");
    seedPost(db, { id: "post:1", bufferPostId: "buf1", keyword: "ai agents" });

    const client = fakeClient([
      bufferPost({
        id: "buf1",
        status: "sent",
        metrics: [{ type: "engagementRate", name: "Engagement rate", value: 0.08, unit: "percentage" }],
      }),
    ]);

    const result = await collectPostPerformance(db, client, "org1");

    expect(result.feedback).toEqual([
      expect.objectContaining({ keyword: "ai agents", value: 0.08 }),
    ]);
    const row = db.select().from(rankings).where(eq(rankings.keyword, "ai agents")).get();
    expect(row?.value).toBe(0.08);
  });

  it("averages engagementRate across multiple posts sharing a keyword", async () => {
    const db = createDb(":memory:");
    seedPost(db, { id: "post:1", bufferPostId: "buf1", keyword: "ai agents" });
    seedPost(db, { id: "post:2", bufferPostId: "buf2", keyword: "ai agents" });

    const client = fakeClient([
      bufferPost({
        id: "buf1",
        status: "sent",
        metrics: [{ type: "engagementRate", name: "Engagement rate", value: 0.05, unit: "percentage" }],
      }),
      bufferPost({
        id: "buf2",
        status: "sent",
        metrics: [{ type: "engagementRate", name: "Engagement rate", value: 0.15, unit: "percentage" }],
      }),
    ]);

    const result = await collectPostPerformance(db, client, "org1");

    expect(result.feedback).toHaveLength(1);
    expect(result.feedback[0]?.keyword).toBe("ai agents");
    expect(result.feedback[0]?.value).toBeCloseTo(0.1);
  });

  it("falls back to a reach-normalized composite of reactions+clicks when engagementRate is absent", async () => {
    const db = createDb(":memory:");
    seedPost(db, { id: "post:1", bufferPostId: "buf2", keyword: "saas" });

    const client = fakeClient([
      bufferPost({
        id: "buf2",
        status: "sent",
        metrics: [
          { type: "reach", name: "Reach", value: 1000, unit: "count" },
          { type: "reactions", name: "Reactions", value: 40, unit: "count" },
          { type: "clicks", name: "Clicks", value: 10, unit: "count" },
        ],
      }),
    ]);

    const result = await collectPostPerformance(db, client, "org1");

    expect(result.feedback[0]).toMatchObject({ keyword: "saas", value: 0.05 });
  });

  it("updates rows with no keyword but does not feed them into rankings", async () => {
    const db = createDb(":memory:");
    seedPost(db, { id: "post:1", bufferPostId: "buf1", keyword: null });

    const client = fakeClient([
      bufferPost({
        id: "buf1",
        status: "sent",
        metrics: [{ type: "engagementRate", name: "Engagement rate", value: 0.1, unit: "percentage" }],
      }),
    ]);

    const result = await collectPostPerformance(db, client, "org1");

    expect(result.updated).toBe(1);
    expect(result.feedback).toEqual([]);
    const row = db.select().from(publishedPosts).where(eq(publishedPosts.id, "post:1")).get();
    expect(row?.status).toBe("sent");
  });

  it("is a no-op when there are no rows with a bufferPostId and status other than sent", async () => {
    const db = createDb(":memory:");
    seedPost(db, { id: "post:1", bufferPostId: null });
    seedPost(db, { id: "post:2", bufferPostId: "buf1", status: "sent" });

    const client = fakeClient([bufferPost({ id: "buf1", status: "sent" })]);

    const result = await collectPostPerformance(db, client, "org1");

    expect(result.updated).toBe(0);
    expect(result.feedback).toEqual([]);
    expect(client.listPosts).not.toHaveBeenCalled();
  });
});
