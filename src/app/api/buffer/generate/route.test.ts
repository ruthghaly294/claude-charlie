import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GeneratedPostSet } from "@/publishing/postGenerator";

const generatePosts = vi.fn();
const getPostGenerator = vi.fn(() => ({ generatePosts }));
vi.mock("@/publishing/postGenerator", () => ({
  getPostGenerator,
  PLATFORMS: ["x", "reddit", "instagram", "facebook"],
  MAX_AMALGAMATION_ITEMS: 5,
  X_MAX_LENGTH: 280,
}));

const loadConfig = vi.fn(() => ({
  businessName: "Signal Desk",
  businessDescription: "intel for solo operators",
  profile: {
    goals: [],
    weeklyHours: 10,
    skills: [],
    risk: "medium",
    monetizationTarget: "",
    audience: "indie hackers",
    voice: "dry and sardonic",
  },
}));
vi.mock("@/discovery/config", () => ({ loadConfig }));

function postReq(body: unknown): Request {
  return new Request("http://t/api/buffer/generate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const validBody = {
  topic: "AI coding agents",
  items: [
    {
      title: "Cursor hits 1M users",
      url: "https://example.com/post/1",
      snippet: "Adoption is accelerating.",
      engagement: { upvotes: 420 },
    },
  ],
};

const v = (text: string) => ({ text, hashtags: [] });
const SET: GeneratedPostSet = {
  variants: {
    x: v("X post\n\nhttps://example.com/post/1"),
    reddit: v("Reddit post\n\nhttps://example.com/post/1"),
    instagram: v("IG post\n\nhttps://example.com/post/1"),
    facebook: v("FB post\n\nhttps://example.com/post/1"),
  },
  assetPrompt: "A vibrant illustration of AI coding agents collaborating.",
};

describe("POST /api/buffer/generate", () => {
  beforeEach(() => {
    generatePosts.mockReset();
    getPostGenerator.mockClear();
  });

  it("400s on an invalid body", async () => {
    const { POST } = await import("./route");
    const res = await POST(postReq({ topic: "a" }));
    expect(res.status).toBe(400);
    expect(generatePosts).not.toHaveBeenCalled();
  });

  it("400s when items is empty or exceeds MAX_AMALGAMATION_ITEMS", async () => {
    const { POST } = await import("./route");

    const empty = await POST(postReq({ ...validBody, items: [] }));
    expect(empty.status).toBe(400);

    const tooMany = await POST(
      postReq({ ...validBody, items: Array(6).fill(validBody.items[0]) }),
    );
    expect(tooMany.status).toBe(400);

    expect(generatePosts).not.toHaveBeenCalled();
  });

  it("200s with a per-platform draft map on success", async () => {
    generatePosts.mockResolvedValue(SET);
    const { POST } = await import("./route");

    const res = await POST(postReq(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drafts).toEqual({
      x: { text: SET.variants.x.text, hashtags: [], issues: [] },
      reddit: { text: SET.variants.reddit.text, hashtags: [], issues: [] },
      instagram: {
        text: SET.variants.instagram.text,
        hashtags: [],
        issues: [
          "Instagram posts need a cover image",
          "Instagram posts should include at least one hashtag",
        ],
      },
      facebook: { text: SET.variants.facebook.text, hashtags: [], issues: [] },
    });
    expect(body.assetPrompt).toBe(SET.assetPrompt);
    expect(generatePosts).toHaveBeenCalledWith({
      topic: validBody.topic,
      items: validBody.items,
    });
    expect(getPostGenerator).toHaveBeenCalledWith(
      expect.objectContaining({
        businessName: "Signal Desk",
        voice: "dry and sardonic",
        profile: expect.objectContaining({ audience: "indie hackers" }),
      }),
      expect.anything(),
    );
  });

  it("returns the error message on failure", async () => {
    generatePosts.mockRejectedValue(new Error("boom"));
    const { POST } = await import("./route");

    const res = await POST(postReq(validBody));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("boom");
  });
});
