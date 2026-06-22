import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createBufferClient,
  resolveOrgId,
  _resetOrgIdCache,
  BufferApiError,
} from "./bufferClient";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const POST_NODE = {
  id: "p1",
  status: "scheduled",
  text: "hello",
  dueAt: null,
  sentAt: null,
  channelId: "c1",
  channelService: "instagram",
  error: null,
};

function lastCall(fetchImpl: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchImpl.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) as { query: string; variables: unknown } };
}

describe("createBufferClient", () => {
  beforeEach(() => {
    _resetOrgIdCache();
  });

  it("is unconfigured without a token, and methods reject clearly", async () => {
    const fetchImpl = vi.fn();
    const client = createBufferClient({}, fetchImpl);
    expect(client.configured).toBe(false);
    await expect(client.getAccount()).rejects.toThrow(/BUFFER_ACCESS_TOKEN not configured/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the GraphQL request to graph.buffer.com with a Bearer token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ data: { account: { id: "acc1", organizations: [{ id: "org1", name: "Acme" }] } } }),
    );
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok123" }, fetchImpl);

    const account = await client.getAccount();
    expect(account).toEqual({ id: "acc1", organizations: [{ id: "org1", name: "Acme" }] });

    const { url, init, body } = lastCall(fetchImpl);
    expect(url).toBe("https://api.buffer.com/graphql");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok123");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(body.query).toMatch(/account/);
  });

  it("lists channels for an organization", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          channels: [
            { id: "c1", name: "frcrbank", displayName: "frcrbank", service: "instagram", avatar: "https://x/a.png" },
          ],
        },
      }),
    );
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);

    const channels = await client.listChannels("org1");
    expect(channels).toEqual([
      { id: "c1", name: "frcrbank", displayName: "frcrbank", service: "instagram", avatar: "https://x/a.png" },
    ]);

    const { body } = lastCall(fetchImpl);
    expect(body.variables).toEqual({ input: { organizationId: "org1" } });
  });

  it("rejects with a clear error on malformed channel responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ data: { channels: [{ name: "frcrbank" }] } }), // missing required id/service
    );
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);
    await expect(client.listChannels("org1")).rejects.toThrow(BufferApiError);
  });

  it("throws on GraphQL errors[]", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: "bad query" }] }));
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);
    await expect(client.getAccount()).rejects.toThrow(/bad query/);
  });

  it("throws a token-specific message on HTTP 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "bad" }, fetchImpl);
    await expect(client.getAccount()).rejects.toThrow(/publish\.buffer\.com\/settings\/api/);
  });

  it("throws on other non-ok HTTP statuses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);
    await expect(client.getAccount()).rejects.toThrow(/HTTP 500/);
  });

  describe("HTTP 429 rate-limit handling", () => {
    it("retries after a 429 and succeeds once the throttle clears", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({}, 429))
        .mockResolvedValueOnce(
          jsonResponse({ data: { createPost: { __typename: "PostActionSuccess", post: POST_NODE } } }),
        );
      const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl, sleep);

      const post = await client.createPost({ channelId: "c1", text: "hi" });
      expect(post.id).toBe("p1");
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledTimes(1);
    });

    it("honors the Retry-After header (seconds) when Buffer throttles", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const throttled = new Response("{}", { status: 429, headers: { "retry-after": "2" } });
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(throttled)
        .mockResolvedValueOnce(
          jsonResponse({ data: { account: { id: "a", organizations: [] } } }),
        );
      const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl, sleep);

      await client.getAccount();
      expect(sleep).toHaveBeenCalledWith(2000);
    });

    it("gives up with an HTTP 429 error after exhausting retries", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 429));
      const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl, sleep);

      await expect(client.getAccount()).rejects.toThrow(/HTTP 429/);
      expect(fetchImpl).toHaveBeenCalledTimes(4);
    });

    it("retries a stalled/aborted request (timeout) instead of hanging", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const fetchImpl = vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }))
        .mockResolvedValueOnce(
          jsonResponse({ data: { account: { id: "a", organizations: [{ id: "o", name: "n" }] } } }),
        );
      const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl, sleep);

      const acc = await client.getAccount();
      expect(acc.id).toBe("a");
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      // the request carries an abort signal so a stall can be cancelled
      expect((fetchImpl.mock.calls[0]![1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    });

    it("surfaces a clear error when the request keeps failing/stalling", async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
      const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl, sleep);

      await expect(client.getAccount()).rejects.toThrow(/Buffer request failed after 4 attempts/);
      expect(fetchImpl).toHaveBeenCalledTimes(4);
    });
  });

  describe("createPost mapping", () => {
    function clientWithSuccess() {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({ data: { createPost: { __typename: "PostActionSuccess", post: POST_NODE } } }),
      );
      return { fetchImpl, client: createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl) };
    }

    it("defaults to addToQueue with no assets/metadata", async () => {
      const { fetchImpl, client } = clientWithSuccess();
      const post = await client.createPost({ channelId: "c1", text: "hi" });
      expect(post).toEqual({
        id: "p1",
        status: "scheduled",
        text: "hello",
        dueAt: null,
        sentAt: null,
        channelId: "c1",
        channelService: "instagram",
        error: null,
        metrics: [],
        metricsUpdatedAt: null,
        imageUrl: null,
      });

      const { body } = lastCall(fetchImpl);
      const input = (body.variables as { input: Record<string, unknown> }).input;
      expect(input.mode).toBe("addToQueue");
      expect(input.channelId).toBe("c1");
      expect(input.text).toBe("hi");
      expect(input.assets).toEqual([]);
      expect(input.metadata).toBeUndefined();
      expect(input.dueAt).toBeUndefined();
    });

    it("maps dueAt to customScheduled", async () => {
      const { fetchImpl, client } = clientWithSuccess();
      await client.createPost({ channelId: "c1", text: "hi", dueAt: "2026-07-01T12:00:00Z" });
      const { body } = lastCall(fetchImpl);
      const input = (body.variables as { input: Record<string, unknown> }).input;
      expect(input.mode).toBe("customScheduled");
      expect(input.dueAt).toBe("2026-07-01T12:00:00Z");
    });

    it("maps shareNow to the shareNow mode", async () => {
      const { fetchImpl, client } = clientWithSuccess();
      await client.createPost({ channelId: "c1", text: "hi", shareNow: true });
      const { body } = lastCall(fetchImpl);
      const input = (body.variables as { input: Record<string, unknown> }).input;
      expect(input.mode).toBe("shareNow");
    });

    it("attaches an image asset with alt text", async () => {
      const { fetchImpl, client } = clientWithSuccess();
      await client.createPost({
        channelId: "c1",
        text: "hi",
        imageUrl: "https://x/img.png",
        altText: "a cat",
      });
      const { body } = lastCall(fetchImpl);
      const input = (body.variables as { input: Record<string, unknown> }).input;
      expect(input.assets).toEqual([
        { image: { url: "https://x/img.png", metadata: { altText: "a cat" } } },
      ]);
    });

    it("attaches multiple image assets for a carousel (Instagram 'post' with 2+ images)", async () => {
      const { fetchImpl, client } = clientWithSuccess();
      await client.createPost({
        channelId: "c1",
        text: "qotd",
        instagramType: "post",
        imageUrls: ["https://x/s1.png", "https://x/s2.png", "https://x/s3.png"],
      });
      const { body } = lastCall(fetchImpl);
      const input = (body.variables as { input: Record<string, unknown> }).input;
      expect(input.assets).toEqual([
        { image: { url: "https://x/s1.png" } },
        { image: { url: "https://x/s2.png" } },
        { image: { url: "https://x/s3.png" } },
      ]);
      expect(input.metadata).toEqual({ instagram: { type: "post", shouldShareToFeed: true } });
    });

    it("prefers multiple imageUrls over a single imageUrl", async () => {
      const { fetchImpl, client } = clientWithSuccess();
      await client.createPost({
        channelId: "c1",
        text: "qotd",
        instagramType: "post",
        imageUrl: "https://x/single.png",
        imageUrls: ["https://x/s1.png", "https://x/s2.png"],
      });
      const { body } = lastCall(fetchImpl);
      const input = (body.variables as { input: Record<string, unknown> }).input;
      expect(input.assets).toEqual([
        { image: { url: "https://x/s1.png" } },
        { image: { url: "https://x/s2.png" } },
      ]);
    });

    it("attaches instagram metadata when instagramType is set", async () => {
      const { fetchImpl, client } = clientWithSuccess();
      await client.createPost({
        channelId: "c1",
        text: "hi",
        imageUrl: "https://x/img.png",
        instagramType: "reel",
      });
      const { body } = lastCall(fetchImpl);
      const input = (body.variables as { input: Record<string, unknown> }).input;
      expect(input.metadata).toEqual({ instagram: { type: "reel", shouldShareToFeed: true } });
    });

    it("attaches a video asset with a thumbnail", async () => {
      const { fetchImpl, client } = clientWithSuccess();
      await client.createPost({
        channelId: "c1",
        text: "hi",
        videoUrl: "https://x/clip.mp4",
        thumbnailUrl: "https://x/thumb.png",
      });
      const { body } = lastCall(fetchImpl);
      const input = (body.variables as { input: Record<string, unknown> }).input;
      expect(input.assets).toEqual([
        { video: { url: "https://x/clip.mp4", thumbnailUrl: "https://x/thumb.png" } },
      ]);
    });

    it("prefers the video asset over an image when both are provided", async () => {
      const { fetchImpl, client } = clientWithSuccess();
      await client.createPost({
        channelId: "c1",
        text: "hi",
        imageUrl: "https://x/img.png",
        videoUrl: "https://x/clip.mp4",
      });
      const { body } = lastCall(fetchImpl);
      const input = (body.variables as { input: Record<string, unknown> }).input;
      expect(input.assets).toEqual([{ video: { url: "https://x/clip.mp4" } }]);
    });

    it("editPost moves a draft into the queue (or schedules it) keeping the video asset", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({ data: { editPost: { __typename: "PostActionSuccess", post: POST_NODE } } }),
      );
      const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);
      await client.editPost({
        id: "p1",
        channelId: "c1",
        text: "approved caption",
        videoUrl: "https://x/clip.mp4",
        thumbnailUrl: "https://x/thumb.png",
        instagramType: "reel",
        dueAt: "2026-07-01T12:00:00Z",
        saveToDraft: false,
      });
      const { body } = lastCall(fetchImpl);
      const input = (body.variables as { input: Record<string, unknown> }).input;
      expect(input.id).toBe("p1");
      expect(input.channelId).toBeUndefined(); // EditPostInput has no channelId
      expect(input.mode).toBe("customScheduled");
      expect(input.saveToDraft).toBe(false);
      expect(input.assets).toEqual([
        { video: { url: "https://x/clip.mp4", thumbnailUrl: "https://x/thumb.png" } },
      ]);
      expect(input.metadata).toEqual({ instagram: { type: "reel", shouldShareToFeed: true } });
    });

    it("passes saveToDraft through when set", async () => {
      const { fetchImpl, client } = clientWithSuccess();
      await client.createPost({ channelId: "c1", text: "hi", saveToDraft: true });
      const { body } = lastCall(fetchImpl);
      const input = (body.variables as { input: Record<string, unknown> }).input;
      expect(input.saveToDraft).toBe(true);
    });

    it("omits saveToDraft when not set", async () => {
      const { fetchImpl, client } = clientWithSuccess();
      await client.createPost({ channelId: "c1", text: "hi" });
      const { body } = lastCall(fetchImpl);
      const input = (body.variables as { input: Record<string, unknown> }).input;
      expect(input.saveToDraft).toBeUndefined();
    });

    it("throws BufferApiError on a MutationError payload", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({
          data: { createPost: { __typename: "InvalidInputError", message: "text is required" } },
        }),
      );
      const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);
      await expect(client.createPost({ channelId: "c1", text: "" })).rejects.toThrow(
        /text is required/,
      );
    });
  });

  it("lists posts with a status filter", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ data: { posts: { edges: [{ node: POST_NODE }] } } }),
    );
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);

    const posts = await client.listPosts("org1", { status: ["error"] });
    expect(posts).toEqual([
      {
        id: "p1",
        status: "scheduled",
        text: "hello",
        dueAt: null,
        sentAt: null,
        channelId: "c1",
        channelService: "instagram",
        error: null,
        metrics: [],
        metricsUpdatedAt: null,
        imageUrl: null,
      },
    ]);

    const { body } = lastCall(fetchImpl);
    expect(body.variables).toEqual({
      input: { organizationId: "org1", filter: { status: ["error"] } },
      first: 50,
    });
  });

  it("includes metrics and metricsUpdatedAt when present", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          posts: {
            edges: [
              {
                node: {
                  ...POST_NODE,
                  metrics: [
                    { type: "engagementRate", name: "Engagement rate", value: 0.042, unit: "percentage" },
                  ],
                  metricsUpdatedAt: "2026-06-01T00:00:00.000Z",
                },
              },
            ],
          },
        },
      }),
    );
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);

    const [post] = await client.listPosts("org1");
    expect(post?.metrics).toEqual([
      { type: "engagementRate", name: "Engagement rate", value: 0.042, unit: "percentage" },
    ]);
    expect(post?.metricsUpdatedAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("defaults metrics to [] and metricsUpdatedAt to null when absent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ data: { posts: { edges: [{ node: POST_NODE }] } } }),
    );
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);

    const [post] = await client.listPosts("org1");
    expect(post?.metrics).toEqual([]);
    expect(post?.metricsUpdatedAt).toBeNull();
  });

  it("normalizes a null metrics field (as returned by Buffer for posts with no metrics yet) to []", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          posts: {
            edges: [{ node: { ...POST_NODE, metrics: null, metricsUpdatedAt: null } }],
          },
        },
      }),
    );
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);

    const [post] = await client.listPosts("org1");
    expect(post?.metrics).toEqual([]);
  });

  it("defaults imageUrl to null when a post has no assets", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ data: { posts: { edges: [{ node: POST_NODE }] } } }),
    );
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);

    const [post] = await client.listPosts("org1");
    expect(post?.imageUrl).toBeNull();
  });

  it("derives imageUrl from the post's image asset", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          posts: {
            edges: [
              {
                node: {
                  ...POST_NODE,
                  assets: [
                    {
                      type: "image",
                      source: "https://cdn.example/asset.png",
                      thumbnail: "https://cdn.example/thumb.png",
                    },
                  ],
                },
              },
            ],
          },
        },
      }),
    );
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);

    const [post] = await client.listPosts("org1");
    expect(post?.imageUrl).toBe("https://cdn.example/asset.png");
  });

  it("ignores non-image assets when deriving imageUrl", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          posts: {
            edges: [
              {
                node: {
                  ...POST_NODE,
                  assets: [
                    {
                      type: "video",
                      source: "https://cdn.example/video.mp4",
                      thumbnail: "https://cdn.example/poster.png",
                    },
                  ],
                },
              },
            ],
          },
        },
      }),
    );
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);

    const [post] = await client.listPosts("org1");
    expect(post?.imageUrl).toBeNull();
  });

  it("deletes a post", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ data: { deletePost: { __typename: "DeletePostSuccess", id: "p1" } } }),
    );
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);
    await expect(client.deletePost("p1")).resolves.toEqual({ ok: true });
  });

  it("throws when deletePost returns VoidMutationError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ data: { deletePost: { __typename: "VoidMutationError", message: "not found" } } }),
    );
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);
    await expect(client.deletePost("p1")).rejects.toThrow(/not found/);
  });

  it("retries a post by fetching it and re-submitting via editPost", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { post: { ...POST_NODE, status: "error" } } }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { editPost: { __typename: "PostActionSuccess", post: { ...POST_NODE, status: "sent" } } } }),
      );
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);

    const result = await client.retryPost("p1");
    expect(result.status).toBe("sent");

    const editCall = JSON.parse(fetchImpl.mock.calls[1]![1].body as string) as {
      variables: { input: Record<string, unknown> };
    };
    expect(editCall.variables.input).toEqual({
      id: "p1",
      text: "hello",
      schedulingType: "automatic",
      mode: "shareNow",
    });
  });

  it("getPost fetches a single post's current status/error", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { post: { ...POST_NODE, status: "sent", sentAt: "2026-06-18T00:00:00Z" } } }));
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);

    const post = await client.getPost("p1");
    expect(post.status).toBe("sent");
    expect(post.sentAt).toBe("2026-06-18T00:00:00Z");

    const call = JSON.parse(fetchImpl.mock.calls[0]![1].body as string) as {
      variables: { input: Record<string, unknown> };
    };
    expect(call.variables.input).toEqual({ id: "p1" });
  });
});

describe("resolveOrgId", () => {
  beforeEach(() => {
    _resetOrgIdCache();
  });

  it("caches the first organization id across calls", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ data: { account: { id: "acc1", organizations: [{ id: "org1", name: "Acme" }] } } }),
    );
    const client = createBufferClient({ BUFFER_ACCESS_TOKEN: "tok" }, fetchImpl);

    expect(await resolveOrgId(client)).toBe("org1");
    expect(await resolveOrgId(client)).toBe("org1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
