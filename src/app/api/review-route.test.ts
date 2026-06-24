import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BufferClient, BufferPost } from "@/publishing/bufferClient";

const createBufferClient = vi.fn();
const resolveOrgId = vi.fn();

vi.mock("@/publishing/bufferClient", () => ({ createBufferClient, resolveOrgId }));

// The route only reads the Instagram channel id off the config; stub it so the
// test doesn't depend on the on-disk decode.config.yml.
vi.mock("@/discovery/config", () => ({
  loadConfig: () => ({ publishing: { channelsByPlatform: { instagram: "6a2c16ff38b55793458ab515" } } }),
}));

// Empty, isolated DB so only Buffer-sourced drafts surface in these tests.
process.env.DECODE_DB_PATH = ":memory:";

const { GET, POST } = await import("./review/route");

// The Instagram channel id the daily QOTD scheduler publishes to (decode.config.yml).
const IG_CHANNEL = "6a2c16ff38b55793458ab515";

const CAROUSEL_DRAFT: BufferPost = {
  id: "6a3a61601984044b73b54352",
  status: "draft",
  text: "Rotating anodes distribute the electron beam impact…",
  dueAt: null,
  sentAt: null,
  channelId: IG_CHANNEL,
  channelService: "instagram",
  error: null,
  metrics: [],
  metricsUpdatedAt: null,
  imageUrl: "https://r2/slide1.png",
  imageUrls: Array.from({ length: 7 }, (_, i) => `https://r2/slide${i + 1}.png`),
};

function client(overrides: Partial<BufferClient> = {}): BufferClient {
  return {
    configured: true,
    getAccount: vi.fn(),
    listChannels: vi.fn(),
    listPosts: vi.fn().mockResolvedValue([CAROUSEL_DRAFT]),
    createPost: vi.fn(),
    deletePost: vi.fn().mockResolvedValue({ ok: true }),
    editPost: vi.fn().mockResolvedValue(CAROUSEL_DRAFT),
    retryPost: vi.fn(),
    getPost: vi.fn().mockResolvedValue(CAROUSEL_DRAFT),
    ...overrides,
  };
}

describe("GET /api/review", () => {
  beforeEach(() => {
    createBufferClient.mockReset();
    resolveOrgId.mockReset().mockResolvedValue("org1");
  });

  it("surfaces a Buffer-only carousel draft (e.g. created by CI) as a reviewable item", async () => {
    createBufferClient.mockReturnValue(client());
    const res = await GET();
    const { items } = (await res.json()) as { items: Array<Record<string, unknown>> };
    const item = items.find((i) => i.bufferPostId === CAROUSEL_DRAFT.id);
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      id: CAROUSEL_DRAFT.id,
      status: "draft",
      format: "qotd-carousel",
      bufferPostId: CAROUSEL_DRAFT.id,
    });
    expect(item!.slideUrls).toHaveLength(7);
  });

  it("falls back to local rows (never 500s) when Buffer is unreachable", async () => {
    createBufferClient.mockReturnValue(client({ listPosts: vi.fn().mockRejectedValue(new Error("throttled")) }));
    const res = await GET();
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: unknown[] };
    expect(Array.isArray(items)).toBe(true);
  });
});

describe("POST /api/review (Buffer-only draft)", () => {
  beforeEach(() => {
    createBufferClient.mockReset();
    resolveOrgId.mockReset().mockResolvedValue("org1");
  });

  it("publishes a draft that exists only on Buffer (no local DB row)", async () => {
    const sent = { ...CAROUSEL_DRAFT, status: "sent" as const, sentAt: "2026-06-24T07:00:00.000Z" };
    const c = client({ getPost: vi.fn().mockResolvedValue(sent) });
    createBufferClient.mockReturnValue(c);

    const res = await POST(
      new Request("http://x/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: CAROUSEL_DRAFT.id, action: "publish" }),
      }),
    );
    const json = (await res.json()) as { published?: boolean; status?: string };
    expect(c.editPost).toHaveBeenCalledWith(expect.objectContaining({ id: CAROUSEL_DRAFT.id, shareNow: true }));
    expect(json.published).toBe(true);
    expect(json.status).toBe("published");
  });

  it("404s when the id is neither a local row nor a Buffer post", async () => {
    createBufferClient.mockReturnValue(client({ getPost: vi.fn().mockRejectedValue(new Error("not found")) }));
    const res = await POST(
      new Request("http://x/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "nope", action: "publish" }),
      }),
    );
    expect(res.status).toBe(404);
  });
});
