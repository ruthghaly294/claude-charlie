import { describe, it, expect, vi } from "vitest";
import { createReplicateClient, ReplicateApiError } from "./replicateClient";

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as Response;
const fail = (status: number, body = "nope") =>
  ({ ok: false, status, json: async () => ({}), text: async () => body }) as Response;

describe("createReplicateClient", () => {
  it("is not configured without REPLICATE_API_TOKEN", () => {
    expect(createReplicateClient({}).configured).toBe(false);
  });

  it("generateAsset creates a prediction on the image model and returns the output URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      ok({ id: "p1", status: "succeeded", output: ["https://replicate.delivery/cover.png"], urls: { get: "g" } }),
    );
    const client = createReplicateClient(
      { REPLICATE_API_TOKEN: "t" },
      { fetchImpl, imageModel: "black-forest-labs/flux-schnell" },
    );

    await expect(client.generateAsset("a cover")).resolves.toEqual({
      url: "https://replicate.delivery/cover.png",
      type: "image",
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.input.prompt).toBe("a cover");
    expect(body.input.aspect_ratio).toBe("16:9");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer t" });
  });

  it("generateAsset honors imageAspectRatio + a custom image model (infographic path)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      ok({ status: "succeeded", output: ["https://replicate.delivery/info.jpg"], urls: { get: "g" } }),
    );
    const client = createReplicateClient(
      { REPLICATE_API_TOKEN: "t" },
      { fetchImpl, imageModel: "google/nano-banana", imageAspectRatio: "9:16" },
    );

    await client.generateAsset("an infographic");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.replicate.com/v1/models/google/nano-banana/predictions");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.input.aspect_ratio).toBe("9:16");
  });

  it("generateVideo passes the start image as a URL input (no download needed)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      ok({ id: "p2", status: "succeeded", output: "https://replicate.delivery/clip.mp4", urls: { get: "g" } }),
    );
    const client = createReplicateClient(
      { REPLICATE_API_TOKEN: "t" },
      { fetchImpl, videoModel: "minimax/video-01", videoImageKey: "first_frame_image" },
    );

    await expect(
      client.generateVideo({ prompt: "vertical clip", startImage: "https://cdn/cover.png" }),
    ).resolves.toEqual({ url: "https://replicate.delivery/clip.mp4", type: "video" });

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.input.prompt).toBe("vertical clip");
    expect(body.input.first_frame_image).toBe("https://cdn/cover.png");
  });

  it("sends the end image only when videoEndImageKey is configured", async () => {
    // configured ⇒ end frame sent under the configured key
    const withKey = vi.fn<typeof fetch>(async () => ok({ status: "succeeded", output: "https://x/o.mp4", urls: { get: "g" } }));
    const c1 = createReplicateClient(
      { REPLICATE_API_TOKEN: "t" },
      { fetchImpl: withKey, videoModel: "owner/m", videoImageKey: "first_frame_image", videoEndImageKey: "last_frame_image" },
    );
    await c1.generateVideo({ prompt: "p", startImage: "https://cdn/a.png", endImage: "https://cdn/z.png" });
    const b1 = JSON.parse((withKey.mock.calls[0]![1] as RequestInit).body as string);
    expect(b1.input.last_frame_image).toBe("https://cdn/z.png");

    // not configured ⇒ end frame dropped
    const noKey = vi.fn<typeof fetch>(async () => ok({ status: "succeeded", output: "https://x/o.mp4", urls: { get: "g" } }));
    const c2 = createReplicateClient(
      { REPLICATE_API_TOKEN: "t" },
      { fetchImpl: noKey, videoModel: "owner/m", videoImageKey: "first_frame_image" },
    );
    await c2.generateVideo({ prompt: "p", startImage: "https://cdn/a.png", endImage: "https://cdn/z.png" });
    const b2 = JSON.parse((noKey.mock.calls[0]![1] as RequestInit).body as string);
    expect(b2.input.last_frame_image).toBeUndefined();
  });

  it("uses the version endpoint when the model id contains a ':' version hash", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ok({ status: "succeeded", output: "https://x/o.mp4", urls: { get: "g" } }));
    const client = createReplicateClient({ REPLICATE_API_TOKEN: "t" }, { fetchImpl, videoModel: "owner/m:abc123" });
    await client.generateVideo({ prompt: "p" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.replicate.com/v1/predictions");
    expect(JSON.parse((init as RequestInit).body as string).version).toBe("abc123");
  });

  it("polls until the prediction reaches a terminal status", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(ok({ status: "processing", urls: { get: "https://api/p/1" } }))
      .mockResolvedValueOnce(ok({ status: "processing", urls: { get: "https://api/p/1" } }))
      .mockResolvedValueOnce(ok({ status: "succeeded", output: "https://x/done.mp4", urls: { get: "https://api/p/1" } }));
    const client = createReplicateClient(
      { REPLICATE_API_TOKEN: "t" },
      { fetchImpl, sleep: async () => {}, videoModel: "owner/m" },
    );
    const out = await client.generateVideo({ prompt: "p" });
    expect(out.url).toBe("https://x/done.mp4");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries on HTTP 429 (rate limit) then succeeds", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(fail(429, '{"detail":"throttled"}'))
      .mockResolvedValueOnce(ok({ status: "succeeded", output: "https://x/after-429.mp4", urls: { get: "g" } }));
    const sleep = vi.fn(async () => {});
    const client = createReplicateClient(
      { REPLICATE_API_TOKEN: "t" },
      { fetchImpl, sleep, videoModel: "owner/m" },
    );
    const out = await client.generateVideo({ prompt: "p" });
    expect(out.url).toBe("https://x/after-429.mp4");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("throws ReplicateApiError when the prediction fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ok({ status: "failed", error: "model exploded", urls: { get: "g" } }));
    const client = createReplicateClient({ REPLICATE_API_TOKEN: "t" }, { fetchImpl, videoModel: "owner/m" });
    await expect(client.generateVideo({ prompt: "p" })).rejects.toThrow(/model exploded/);
  });

  it("surfaces HTTP errors from the API", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => fail(402, "payment required"));
    const client = createReplicateClient({ REPLICATE_API_TOKEN: "t" }, { fetchImpl, imageModel: "owner/m" });
    await expect(client.generateAsset("x")).rejects.toThrow(ReplicateApiError);
  });

  it("rejects when not configured", async () => {
    await expect(createReplicateClient({}).generateAsset("x")).rejects.toThrow(/not configured/i);
  });
});
