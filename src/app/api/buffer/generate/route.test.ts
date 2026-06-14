import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GeneratedPost } from "@/publishing/postGenerator";

const generatePost = vi.fn();
const getPostGenerator = vi.fn(() => ({ generatePost }));
vi.mock("@/publishing/postGenerator", () => ({ getPostGenerator }));

function postReq(body: unknown): Request {
  return new Request("http://t/api/buffer/generate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const validBody = {
  topic: "AI coding agents",
  item: {
    title: "Cursor hits 1M users",
    url: "https://example.com/post/1",
    snippet: "Adoption is accelerating.",
    engagement: { upvotes: 420 },
  },
};

describe("POST /api/buffer/generate", () => {
  beforeEach(() => {
    generatePost.mockReset();
    getPostGenerator.mockClear();
  });

  it("400s on an invalid body", async () => {
    const { POST } = await import("./route");
    const res = await POST(postReq({ topic: "a" }));
    expect(res.status).toBe(400);
    expect(generatePost).not.toHaveBeenCalled();
  });

  it("200s with a DraftSeed-shaped result on success", async () => {
    const result: GeneratedPost = {
      text: "Original take.\n\n#AICoding\n\nhttps://example.com/post/1",
      hashtags: ["AICoding"],
    };
    generatePost.mockResolvedValue(result);
    const { POST } = await import("./route");

    const res = await POST(postReq(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft).toEqual({ text: result.text });
    expect(generatePost).toHaveBeenCalledWith({
      topic: validBody.topic,
      item: validBody.item,
    });
  });

  it("returns the error message on failure", async () => {
    generatePost.mockRejectedValue(new Error("boom"));
    const { POST } = await import("./route");

    const res = await POST(postReq(validBody));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("boom");
  });
});
