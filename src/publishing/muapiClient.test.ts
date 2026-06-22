import { describe, it, expect, vi } from "vitest";
import { createMuapiClient, MuapiApiError } from "./muapiClient";

const noCliAuth = () => false;
const cliAuthed = () => true;
const jsonOut = (url: string) => ({ stdout: JSON.stringify({ outputs: [url] }) + "\n", stderr: "" });

describe("createMuapiClient", () => {
  it("is not configured without MUAPI_API_KEY or a CLI session", () => {
    expect(createMuapiClient({}, {}, vi.fn(), noCliAuth).configured).toBe(false);
  });

  it("is configured with MUAPI_API_KEY", () => {
    expect(createMuapiClient({ MUAPI_API_KEY: "k" }, {}, vi.fn(), noCliAuth).configured).toBe(true);
  });

  it("is configured when the muapi CLI has a saved key", () => {
    expect(createMuapiClient({}, {}, vi.fn(), cliAuthed).configured).toBe(true);
  });

  it("generateAsset shells out to `muapi image generate` and returns outputs[0]", async () => {
    const exec = vi.fn().mockResolvedValue(jsonOut("https://cdn.muapi/cover.png"));
    const client = createMuapiClient({}, { imageModel: "flux-schnell" }, exec, cliAuthed);

    await expect(client.generateAsset("a cover")).resolves.toEqual({
      url: "https://cdn.muapi/cover.png",
      type: "image",
    });
    expect(exec).toHaveBeenCalledWith([
      "image",
      "generate",
      "a cover",
      "-m",
      "flux-schnell",
      "-a",
      "9:16",
      "--wait",
      "--output-json",
    ]);
  });

  it("generateVideo animates the cover URL via `video from-image` (no download needed)", async () => {
    const exec = vi.fn().mockResolvedValue(jsonOut("https://cdn.muapi/clip.mp4"));
    const client = createMuapiClient({}, { videoModel: "seedance-2" }, exec, cliAuthed);

    await expect(
      client.generateVideo({
        prompt: "vertical fast cuts",
        startImage: "https://cdn/cover.png",
        durationSec: 8,
        aspectRatio: "9:16",
      }),
    ).resolves.toEqual({ url: "https://cdn.muapi/clip.mp4", type: "video" });

    expect(exec).toHaveBeenCalledWith([
      "video",
      "from-image",
      "vertical fast cuts",
      "-i",
      "https://cdn/cover.png",
      "-m",
      "seedance-2",
      "-D",
      "8",
      "-a",
      "9:16",
      "--wait",
      "--output-json",
    ]);
  });

  it("generateVideo uses `video generate` (text→video) when no start image", async () => {
    const exec = vi.fn().mockResolvedValue(jsonOut("https://cdn.muapi/clip.mp4"));
    const client = createMuapiClient({}, { videoModel: "veo3-fast" }, exec, cliAuthed);
    await client.generateVideo({ prompt: "p" });
    const args = exec.mock.calls[0]![0] as string[];
    expect(args.slice(0, 2)).toEqual(["video", "generate"]);
    expect(args).not.toContain("-i");
    expect(args).toContain("--output-json");
  });

  it("ignores the provider-agnostic model param and uses the configured muapi model", async () => {
    const exec = vi.fn().mockResolvedValue(jsonOut("https://cdn.muapi/clip.mp4"));
    const client = createMuapiClient({}, { videoModel: "kling-v3-std" }, exec, cliAuthed);
    await client.generateVideo({ prompt: "p", model: "seedance_2_0" });
    const args = exec.mock.calls[0]![0] as string[];
    expect(args[args.indexOf("-m") + 1]).toBe("kling-v3-std");
  });

  it("throws when the CLI prints no usable output URL", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "{}", stderr: "quota exceeded" });
    const client = createMuapiClient({}, {}, exec, cliAuthed);
    await expect(client.generateAsset("x")).rejects.toThrow(/quota exceeded/);
  });

  it("rejects when not configured", async () => {
    const client = createMuapiClient({}, {}, vi.fn(), noCliAuth);
    await expect(client.generateAsset("x")).rejects.toThrow(/not configured/i);
  });
});
