import { describe, it, expect, vi } from "vitest";
import { getTrendingSounds } from "./trendingSounds";

function jsonFetch(body: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

describe("getTrendingSounds", () => {
  it("returns the labeled sample set when live is neither enabled nor token-backed", async () => {
    const fetchImpl = vi.fn();
    const res = await getTrendingSounds({ env: {}, fetchImpl });

    expect(res.live).toBe(false);
    expect(res.sounds.length).toBeGreaterThan(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    // every sample track still carries a royalty-free substitute
    expect(res.sounds.every((s) => s.safe.licence === "royalty-free")).toBe(true);
    // commercial audio is never directly embeddable without an operator library
    expect(res.sounds.every((s) => s.safe.embeddable === false)).toBe(true);
  });

  it("uses the live chart when enabled and the fetch succeeds", async () => {
    const res = await getTrendingSounds({
      connectorConfig: { enabled: true },
      fetchImpl: jsonFetch({
        data: {
          sound_list: [
            { song_id: 1, title: "Live Song", author: "Artist", link: "https://tt/1", play_count: 999 },
          ],
        },
      }),
    });

    expect(res.live).toBe(true);
    expect(res.sounds).toHaveLength(1);
    expect(res.sounds[0]?.trend.title).toBe("Live Song — Artist");
    expect(res.sounds[0]?.trend.whereTrending).toBe("tiktok_sounds");
  });

  it("falls back to the sample set (live:false) when the live fetch throws", async () => {
    const res = await getTrendingSounds({
      connectorConfig: { enabled: true },
      fetchImpl: vi.fn(async () => {
        throw new Error("403 blocked from datacenter IP");
      }),
    });

    expect(res.live).toBe(false);
    expect(res.sounds.length).toBeGreaterThan(0);
  });

  it("maps an operator royalty-free library entry to an embeddable track", async () => {
    const res = await getTrendingSounds({
      env: {},
      library: { hype: "https://cdn/cc0-hype.mp3" },
    });
    const hype = res.sounds.find((s) => s.trend.mood === "hype");
    expect(hype?.safe.embeddable).toBe(true);
    expect(hype?.safe.trackUrl).toBe("https://cdn/cc0-hype.mp3");
  });
});
