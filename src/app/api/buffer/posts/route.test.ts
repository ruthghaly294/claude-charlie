import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";

const listChannels = vi.fn();
const createPost = vi.fn();

vi.mock("@/publishing/bufferClient", () => ({
  createBufferClient: () => ({
    configured: true,
    listChannels,
    createPost,
    getAccount: vi.fn(),
    listPosts: vi.fn(),
    deletePost: vi.fn(),
    retryPost: vi.fn(),
  }),
  resolveOrgId: async () => "org1",
}));

let POST: (req: Request) => Promise<Response>;

const CHANNEL = { id: "c1", name: "x", displayName: "X", service: "x", avatar: "" };

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "buffer-posts-api-"));
  process.env.DECODE_DB_PATH = join(dir, "t.db");
  POST = (await import("./route")).POST;
});

function req(body: unknown): Request {
  return new Request("http://t/api/buffer/posts", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/buffer/posts", () => {
  beforeEach(() => {
    listChannels.mockReset().mockResolvedValue([CHANNEL]);
    createPost.mockReset();
  });

  it("writes a published_posts row when provenance fields are present", async () => {
    createPost.mockResolvedValue({
      id: "p1",
      status: "scheduled",
      text: "hi",
      dueAt: null,
      sentAt: null,
      channelId: "c1",
      channelService: "x",
      error: null,
    });

    const res = await POST(
      req({
        channelId: "c1",
        text: "hi",
        platform: "x",
        topic: "ai agents",
        itemUrl: "https://example.com/a",
        itemTitle: "A title",
        keyword: "ai agents",
      }),
    );
    expect(res.status).toBe(201);

    const { getDb } = await import("@/db/client");
    const { publishedPosts } = await import("@/db/schema");
    const row = getDb().select().from(publishedPosts).where(eq(publishedPosts.bufferPostId, "p1")).get();
    expect(row).toMatchObject({
      id: "post:p1",
      bufferPostId: "p1",
      channelId: "c1",
      platform: "x",
      topic: "ai agents",
      itemUrl: "https://example.com/a",
      itemTitle: "A title",
      keyword: "ai agents",
      text: "hi",
      status: "scheduled",
    });
  });

  it("writes nothing when provenance fields are absent (existing behavior)", async () => {
    createPost.mockResolvedValue({
      id: "p2",
      status: "scheduled",
      text: "hi2",
      dueAt: null,
      sentAt: null,
      channelId: "c1",
      channelService: "x",
      error: null,
    });

    const res = await POST(req({ channelId: "c1", text: "hi2" }));
    expect(res.status).toBe(201);

    const { getDb } = await import("@/db/client");
    const { publishedPosts } = await import("@/db/schema");
    const row = getDb().select().from(publishedPosts).where(eq(publishedPosts.bufferPostId, "p2")).get();
    expect(row).toBeUndefined();
  });
});
