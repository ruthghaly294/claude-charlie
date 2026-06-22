import { describe, it, expect, vi, beforeEach } from "vitest";

const generateAsset = vi.fn();
const createHiggsfieldClient = vi.fn(() => ({ configured: true, generateAsset }));
vi.mock("@/publishing/higgsfieldClient", () => ({ createHiggsfieldClient }));

function postReq(body: unknown): Request {
  return new Request("http://t/api/higgsfield/generate-asset", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/higgsfield/generate-asset", () => {
  beforeEach(() => {
    generateAsset.mockReset();
    createHiggsfieldClient.mockReset();
    createHiggsfieldClient.mockReturnValue({ configured: true, generateAsset });
  });

  it("400s on an invalid body", async () => {
    const { POST } = await import("./route");
    const res = await POST(postReq({ prompt: "" }));
    expect(res.status).toBe(400);
    expect(generateAsset).not.toHaveBeenCalled();
  });

  it("503s when Higgsfield is not configured", async () => {
    createHiggsfieldClient.mockReturnValue({ configured: false, generateAsset });
    const { POST } = await import("./route");
    const res = await POST(postReq({ prompt: "a cover image" }));
    expect(res.status).toBe(503);
    expect(generateAsset).not.toHaveBeenCalled();
  });

  it("200s with the generated asset on success", async () => {
    generateAsset.mockResolvedValue({ url: "https://cdn.example/img.png", type: "image" });
    const { POST } = await import("./route");
    const res = await POST(postReq({ prompt: "a cover image" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      asset: { url: "https://cdn.example/img.png", type: "image" },
    });
    expect(generateAsset).toHaveBeenCalledWith("a cover image");
  });

  it("returns the error message on failure", async () => {
    generateAsset.mockRejectedValue(new Error("boom"));
    const { POST } = await import("./route");
    const res = await POST(postReq({ prompt: "a cover image" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("boom");
  });
});
