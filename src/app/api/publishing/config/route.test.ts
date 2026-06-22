import { describe, it, expect, vi, beforeEach } from "vitest";

const loadConfig = vi.fn(() => ({
  publishing: { channelsByPlatform: { x: "chan-x", instagram: "chan-ig" } },
}));
vi.mock("@/discovery/config", () => ({ loadConfig }));

const createHiggsfieldClient = vi.fn(() => ({ configured: false }));
vi.mock("@/publishing/higgsfieldClient", () => ({ createHiggsfieldClient }));

describe("GET /api/publishing/config", () => {
  beforeEach(() => {
    createHiggsfieldClient.mockReset();
    createHiggsfieldClient.mockReturnValue({ configured: false });
  });

  it("returns channelsByPlatform and higgsfieldConfigured from the loaded config", async () => {
    const { GET } = await import("./route");

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      channelsByPlatform: { x: "chan-x", instagram: "chan-ig" },
      higgsfieldConfigured: false,
    });
  });

  it("reflects higgsfieldConfigured: true when HIGGSFIELD_API_KEY is set", async () => {
    createHiggsfieldClient.mockReturnValue({ configured: true });
    const { GET } = await import("./route");

    const res = await GET();
    expect((await res.json()).higgsfieldConfigured).toBe(true);
  });
});
