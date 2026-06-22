import { describe, it, expect, vi } from "vitest";
import {
  makePexelsProvider,
  pickBestVideoFile,
  getStockProvider,
} from "./stockProvider";

const sampleResponse = {
  videos: [
    {
      id: 123,
      width: 1920,
      height: 1080,
      duration: 12,
      url: "https://www.pexels.com/video/123/",
      user: { name: "Jane Doe", url: "https://www.pexels.com/@jane" },
      video_files: [
        { link: "https://cdn/sd.mp4", quality: "sd", width: 640, height: 360, file_type: "video/mp4" },
        { link: "https://cdn/hd.mp4", quality: "hd", width: 1920, height: 1080, file_type: "video/mp4" },
      ],
    },
    {
      id: 456,
      width: 1080,
      height: 1920,
      duration: 3,
      url: "https://www.pexels.com/video/456/",
      user: { name: "John Roe" },
      video_files: [
        { link: "https://cdn/short.mp4", quality: "hd", width: 1080, height: 1920, file_type: "video/mp4" },
      ],
    },
  ],
};

function fakeFetch(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? status : status }));
}

describe("pickBestVideoFile", () => {
  it("prefers the highest-resolution mp4", () => {
    const best = pickBestVideoFile(sampleResponse.videos[0]!.video_files);
    expect(best?.link).toBe("https://cdn/hd.mp4");
  });
  it("returns null for an empty list", () => {
    expect(pickBestVideoFile([])).toBeNull();
  });
});

describe("makePexelsProvider", () => {
  it("is unconfigured without an api key and returns no clips", async () => {
    const provider = makePexelsProvider({});
    expect(provider.configured).toBe(false);
    expect(await provider.search("anything")).toEqual([]);
  });

  it("maps Pexels videos to license-cleared, embeddable stock clips", async () => {
    const fetchImpl = fakeFetch(sampleResponse) as unknown as typeof fetch;
    const provider = makePexelsProvider({ apiKey: "k", fetchImpl });
    const clips = await provider.search("city skyline");

    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({
      id: "123",
      url: "https://cdn/hd.mp4",
      provider: "pexels",
      author: "Jane Doe",
      embeddable: true,
    });
    expect(clips[0]!.licence).toContain("Pexels");
  });

  it("sends the api key as the Authorization header and requests portrait by default", async () => {
    const fetchImpl = fakeFetch(sampleResponse) as unknown as typeof fetch;
    const provider = makePexelsProvider({ apiKey: "secret", fetchImpl });
    await provider.search("dogs");
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toContain("orientation=portrait");
    expect((call[1] as RequestInit).headers).toMatchObject({ authorization: "secret" });
  });

  it("filters out clips shorter than minDurationSec", async () => {
    const fetchImpl = fakeFetch(sampleResponse) as unknown as typeof fetch;
    const provider = makePexelsProvider({ apiKey: "k", fetchImpl });
    const clips = await provider.search("city", { minDurationSec: 5 });
    expect(clips.map((c) => c.id)).toEqual(["123"]); // 456 is only 3s
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = fakeFetch({}, false, 429) as unknown as typeof fetch;
    const provider = makePexelsProvider({ apiKey: "k", fetchImpl });
    await expect(provider.search("x")).rejects.toThrow(/429/);
  });
});

describe("getStockProvider", () => {
  it("builds a Pexels provider from env", () => {
    expect(getStockProvider({ PEXELS_API_KEY: "k" }).configured).toBe(true);
    expect(getStockProvider({}).configured).toBe(false);
  });
});
