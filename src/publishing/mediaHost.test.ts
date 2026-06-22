import { describe, it, expect, vi } from "vitest";
import { makeMuapiHost, makeR2Host, passthroughHost, getMediaHost, r2ConfigFromEnv } from "./mediaHost";

const R2_CFG = {
  accountId: "acct123",
  bucket: "reels",
  accessKeyId: "ak",
  secretAccessKey: "sk",
  publicBaseUrl: "https://pub-xyz.r2.dev",
};

describe("passthroughHost", () => {
  it("returns the url unchanged", async () => {
    expect(await passthroughHost.persist("https://cdn/x.mp4")).toBe("https://cdn/x.mp4");
  });
});

describe("makeMuapiHost", () => {
  it("downloads then uploads via `muapi upload file` and returns the hosted URL", async () => {
    const resolve = vi.fn(async () => "/tmp/x.mp4");
    const exec = vi.fn(async () => ({ stdout: JSON.stringify({ url: "https://cdn.muapi/hosted.mp4" }), stderr: "" }));
    const host = makeMuapiHost({ exec, resolve });

    await expect(host.persist("https://replicate.delivery/tmp.mp4")).resolves.toBe(
      "https://cdn.muapi/hosted.mp4",
    );
    expect(resolve).toHaveBeenCalledWith("https://replicate.delivery/tmp.mp4");
    expect(exec).toHaveBeenCalledWith(["upload", "file", "/tmp/x.mp4", "--output-json"]);
  });

  it("parses an outputs[] array shape too", async () => {
    const exec = vi.fn(async () => ({ stdout: JSON.stringify({ outputs: ["https://cdn.muapi/o.mp4"] }), stderr: "" }));
    const host = makeMuapiHost({ exec, resolve: async (r) => r });
    await expect(host.persist("https://x/in.mp4")).resolves.toBe("https://cdn.muapi/o.mp4");
  });

  it("falls back to the original URL (best-effort) when upload fails", async () => {
    const onFallback = vi.fn();
    const exec = vi.fn(async () => {
      throw new Error("Insufficient credits");
    });
    const host = makeMuapiHost({ exec, resolve: async (r) => r, onFallback });
    await expect(host.persist("https://x/in.mp4")).resolves.toBe("https://x/in.mp4");
    expect(onFallback).toHaveBeenCalled();
  });

  it("uploads a local file path directly (no download)", async () => {
    const exec = vi.fn(async () => ({ stdout: JSON.stringify({ url: "https://cdn.muapi/o.mp4" }), stderr: "" }));
    const resolve = vi.fn(async (r: string) => r);
    const host = makeMuapiHost({ exec, resolve });
    await expect(host.persist("/tmp/burned.mp4")).resolves.toBe("https://cdn.muapi/o.mp4");
    expect(resolve).not.toHaveBeenCalled(); // local path skips the download step
    expect(exec).toHaveBeenCalledWith(["upload", "file", "/tmp/burned.mp4", "--output-json"]);
  });
});

describe("makeR2Host", () => {
  it("uploads the downloaded bytes and returns the public R2 URL", async () => {
    const upload = vi.fn(async () => {});
    const fetchMedia = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "video/mp4",
      ext: ".mp4",
    }));
    const host = makeR2Host(R2_CFG, { upload, fetchMedia });

    const result = await host.persist("https://replicate.delivery/tmp.mp4");
    expect(result).toMatch(/^https:\/\/pub-xyz\.r2\.dev\/trend-imitation\/[0-9a-f]{32}\.mp4$/);
    expect(fetchMedia).toHaveBeenCalledWith("https://replicate.delivery/tmp.mp4");
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "video/mp4", bytes: new Uint8Array([1, 2, 3]) }),
    );
  });

  it("is content-addressed: identical bytes map to the same key", async () => {
    const upload = vi.fn(async () => {});
    const fetchMedia = async () => ({ bytes: new Uint8Array([9, 9]), contentType: "video/mp4", ext: ".mp4" });
    const host = makeR2Host(R2_CFG, { upload, fetchMedia });
    const a = await host.persist("https://x/a.mp4");
    const b = await host.persist("https://x/b.mp4");
    expect(a).toBe(b);
  });

  it("strips a trailing slash from the public base URL", async () => {
    const host = makeR2Host(
      { ...R2_CFG, publicBaseUrl: "https://pub-xyz.r2.dev/" },
      { upload: async () => {}, fetchMedia: async () => ({ bytes: new Uint8Array([1]), contentType: "video/mp4", ext: ".mp4" }) },
    );
    const result = await host.persist("https://x/a.mp4");
    expect(result).not.toContain(".r2.dev//");
  });

  it("falls back to the original URL when the upload fails", async () => {
    const onFallback = vi.fn();
    const host = makeR2Host(R2_CFG, {
      upload: async () => {
        throw new Error("network down");
      },
      fetchMedia: async () => ({ bytes: new Uint8Array([1]), contentType: "video/mp4", ext: ".mp4" }),
      onFallback,
    });
    await expect(host.persist("https://x/in.mp4")).resolves.toBe("https://x/in.mp4");
    expect(onFallback).toHaveBeenCalled();
  });

  it("reads and uploads a local file path (e.g. an ffmpeg caption-burn output)", async () => {
    const upload = vi.fn(async () => {});
    const readLocal = vi.fn(async () => ({ bytes: new Uint8Array([7, 7, 7]), contentType: "video/mp4", ext: ".mp4" }));
    const host = makeR2Host(R2_CFG, { upload, readLocal });
    const result = await host.persist("/tmp/reuse-abc.mp4");
    expect(readLocal).toHaveBeenCalledWith("/tmp/reuse-abc.mp4");
    expect(result).toMatch(/^https:\/\/pub-xyz\.r2\.dev\/trend-imitation\/[0-9a-f]{32}\.mp4$/);
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "video/mp4", bytes: new Uint8Array([7, 7, 7]) }),
    );
  });
});

describe("r2ConfigFromEnv", () => {
  it("returns null when any required var is missing", () => {
    expect(r2ConfigFromEnv({ R2_ACCOUNT_ID: "a" })).toBeNull();
  });
  it("builds a config when all vars are present", () => {
    const cfg = r2ConfigFromEnv({
      R2_ACCOUNT_ID: "a",
      R2_BUCKET: "b",
      R2_ACCESS_KEY_ID: "k",
      R2_SECRET_ACCESS_KEY: "s",
      R2_PUBLIC_BASE_URL: "https://pub/",
    });
    expect(cfg).toMatchObject({ accountId: "a", bucket: "b", publicBaseUrl: "https://pub/" });
  });
});

describe("getMediaHost", () => {
  it("returns passthrough for 'none'", () => {
    expect(getMediaHost("none")).toBe(passthroughHost);
  });
  it("returns a muapi host for 'muapi'", () => {
    expect(getMediaHost("muapi")).not.toBe(passthroughHost);
  });
  it("falls back to passthrough for 'r2' when R2 is unconfigured", () => {
    const saved = { ...process.env };
    for (const k of ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_PUBLIC_BASE_URL"]) {
      delete process.env[k];
    }
    expect(getMediaHost("r2")).toBe(passthroughHost);
    Object.assign(process.env, saved);
  });
});
