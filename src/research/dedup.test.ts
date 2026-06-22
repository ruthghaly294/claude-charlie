import { describe, it, expect } from "vitest";
import { createDb } from "@/db/client";
import { publishedPosts } from "@/db/schema";
import { markAlreadyPosted } from "./dedup";

function seedPost(
  db: ReturnType<typeof createDb>,
  overrides: Partial<typeof publishedPosts.$inferInsert>,
): void {
  db.insert(publishedPosts)
    .values({
      id: `post:${overrides.itemUrl}`,
      channelId: "c1",
      platform: "x",
      topic: "ai agents",
      itemUrl: "https://example.com/default",
      itemTitle: "Title",
      text: "hi",
      status: "scheduled",
      createdAt: "2026-06-01T00:00:00.000Z",
      ...overrides,
    })
    .run();
}

describe("markAlreadyPosted", () => {
  it("flags items whose url is in published_posts with a non-error status", () => {
    const db = createDb(":memory:");
    seedPost(db, { itemUrl: "https://example.com/posted" });

    const items = [{ url: "https://example.com/posted" }, { url: "https://example.com/new" }];
    const result = markAlreadyPosted(items, db);

    expect(result).toEqual([
      { url: "https://example.com/posted", alreadyPosted: true },
      { url: "https://example.com/new", alreadyPosted: false },
    ]);
  });

  it("does not count published_posts rows with status 'error'", () => {
    const db = createDb(":memory:");
    seedPost(db, { itemUrl: "https://example.com/errored", status: "error" });

    const items = [{ url: "https://example.com/errored" }];
    const result = markAlreadyPosted(items, db);

    expect(result).toEqual([{ url: "https://example.com/errored", alreadyPosted: false }]);
  });

  it("leaves unrelated urls untouched", () => {
    const db = createDb(":memory:");

    const items = [{ url: "https://example.com/unrelated", title: "extra field" }];
    const result = markAlreadyPosted(items, db);

    expect(result).toEqual([
      { url: "https://example.com/unrelated", title: "extra field", alreadyPosted: false },
    ]);
  });
});
