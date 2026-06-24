import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BufferClient, BufferChannel, BufferPost } from "@/publishing/bufferClient";

const createBufferClient = vi.fn();
const resolveOrgId = vi.fn();

vi.mock("@/publishing/bufferClient", () => ({ createBufferClient, resolveOrgId }));

const { GET: getChannels } = await import("./buffer/channels/route");
const { GET: getPosts, POST: postPosts } = await import("./buffer/posts/route");
const { DELETE: deletePost, POST: retryPost } = await import("./buffer/posts/[id]/route");

const CHANNEL: BufferChannel = {
  id: "c1",
  name: "frcrbank",
  displayName: "frcrbank",
  service: "instagram",
  avatar: "https://x/a.png",
};

const POST: BufferPost = {
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
  imageUrls: [],
};

function unconfiguredClient(): BufferClient {
  return {
    configured: false,
    getAccount: vi.fn(),
    listChannels: vi.fn(),
    listPosts: vi.fn(),
    createPost: vi.fn(),
    deletePost: vi.fn(),
    editPost: vi.fn(),
    retryPost: vi.fn(),
    getPost: vi.fn(),
  };
}

function configuredClient(overrides: Partial<BufferClient> = {}): BufferClient {
  return {
    configured: true,
    getAccount: vi.fn(),
    listChannels: vi.fn().mockResolvedValue([CHANNEL]),
    listPosts: vi.fn().mockResolvedValue([POST]),
    createPost: vi.fn().mockResolvedValue(POST),
    deletePost: vi.fn().mockResolvedValue({ ok: true }),
    editPost: vi.fn().mockResolvedValue(POST),
    retryPost: vi.fn().mockResolvedValue(POST),
    getPost: vi.fn().mockResolvedValue(POST),
    ...overrides,
  };
}

function req(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

function withParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/buffer/channels", () => {
  beforeEach(() => {
    createBufferClient.mockReset();
    resolveOrgId.mockReset();
  });

  it("503s when BUFFER_ACCESS_TOKEN is not configured", async () => {
    createBufferClient.mockReturnValue(unconfiguredClient());
    const res = await getChannels();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("BUFFER_ACCESS_TOKEN not configured");
  });

  it("200s with the channel rows", async () => {
    const client = configuredClient();
    createBufferClient.mockReturnValue(client);
    resolveOrgId.mockResolvedValue("org1");

    const res = await getChannels();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [CHANNEL] });
    expect(client.listChannels).toHaveBeenCalledWith("org1");
  });
});

describe("GET /api/buffer/posts", () => {
  beforeEach(() => {
    createBufferClient.mockReset();
    resolveOrgId.mockReset();
  });

  it("503s when BUFFER_ACCESS_TOKEN is not configured", async () => {
    createBufferClient.mockReturnValue(unconfiguredClient());
    const res = await getPosts(req("http://t/api/buffer/posts"));
    expect(res.status).toBe(503);
  });

  it("200s with rows and forwards a parsed status filter", async () => {
    const client = configuredClient();
    createBufferClient.mockReturnValue(client);
    resolveOrgId.mockResolvedValue("org1");

    const res = await getPosts(req("http://t/api/buffer/posts?status=error,scheduled"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [POST] });
    expect(client.listPosts).toHaveBeenCalledWith("org1", { status: ["error", "scheduled"] });
  });

  it("400s on an invalid status filter", async () => {
    createBufferClient.mockReturnValue(configuredClient());
    resolveOrgId.mockResolvedValue("org1");

    const res = await getPosts(req("http://t/api/buffer/posts?status=bogus"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/buffer/posts", () => {
  beforeEach(() => {
    createBufferClient.mockReset();
    resolveOrgId.mockReset();
  });

  function postReq(body: unknown): Request {
    return req("http://t/api/buffer/posts", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }

  it("503s when BUFFER_ACCESS_TOKEN is not configured", async () => {
    createBufferClient.mockReturnValue(unconfiguredClient());
    const res = await postPosts(postReq({ channelId: "c1", text: "hi" }));
    expect(res.status).toBe(503);
  });

  it("400s on an invalid body", async () => {
    createBufferClient.mockReturnValue(configuredClient());
    resolveOrgId.mockResolvedValue("org1");

    const res = await postPosts(postReq({}));
    expect(res.status).toBe(400);
  });

  it("400s when the channel is unknown", async () => {
    createBufferClient.mockReturnValue(configuredClient());
    resolveOrgId.mockResolvedValue("org1");

    const res = await postPosts(postReq({ channelId: "missing", text: "hi" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unknown channel");
  });

  it("400s on an instagram channel without an image", async () => {
    createBufferClient.mockReturnValue(configuredClient());
    resolveOrgId.mockResolvedValue("org1");

    const res = await postPosts(postReq({ channelId: "c1", text: "hi" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Instagram posts require an image");
  });

  it("201s on a happy create", async () => {
    const client = configuredClient();
    createBufferClient.mockReturnValue(client);
    resolveOrgId.mockResolvedValue("org1");

    const res = await postPosts(
      postReq({ channelId: "c1", text: "hi", imageUrl: "https://x/img.png" }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ post: POST });
    expect(client.createPost).toHaveBeenCalledWith({
      channelId: "c1",
      text: "hi",
      imageUrl: "https://x/img.png",
      instagramType: "post",
    });
  });
});

describe("DELETE /api/buffer/posts/[id]", () => {
  beforeEach(() => {
    createBufferClient.mockReset();
  });

  it("503s when BUFFER_ACCESS_TOKEN is not configured", async () => {
    createBufferClient.mockReturnValue(unconfiguredClient());
    const res = await deletePost(req("http://t/api/buffer/posts/p1"), withParams("p1"));
    expect(res.status).toBe(503);
  });

  it("deletes a post", async () => {
    const client = configuredClient();
    createBufferClient.mockReturnValue(client);

    const res = await deletePost(req("http://t/api/buffer/posts/p1"), withParams("p1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(client.deletePost).toHaveBeenCalledWith("p1");
  });
});

describe("POST /api/buffer/posts/[id]?action=retry", () => {
  beforeEach(() => {
    createBufferClient.mockReset();
  });

  it("503s when BUFFER_ACCESS_TOKEN is not configured", async () => {
    createBufferClient.mockReturnValue(unconfiguredClient());
    const res = await retryPost(
      req("http://t/api/buffer/posts/p1?action=retry", { method: "POST" }),
      withParams("p1"),
    );
    expect(res.status).toBe(503);
  });

  it("400s on an unknown action", async () => {
    createBufferClient.mockReturnValue(configuredClient());
    const res = await retryPost(
      req("http://t/api/buffer/posts/p1", { method: "POST" }),
      withParams("p1"),
    );
    expect(res.status).toBe(400);
  });

  it("retries a post", async () => {
    const client = configuredClient();
    createBufferClient.mockReturnValue(client);

    const res = await retryPost(
      req("http://t/api/buffer/posts/p1?action=retry", { method: "POST" }),
      withParams("p1"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ post: POST });
    expect(client.retryPost).toHaveBeenCalledWith("p1");
  });
});
