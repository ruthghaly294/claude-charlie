import { describe, it, expect, vi } from "vitest";
import { createHiggsfieldClient, HiggsfieldApiError } from "./higgsfieldClient";

const noCliAuth = () => false;
const cliAuthed = () => true;

describe("createHiggsfieldClient", () => {
  it("is not configured without HIGGSFIELD_API_KEY or a CLI session", () => {
    expect(createHiggsfieldClient({}, vi.fn(), noCliAuth).configured).toBe(false);
  });

  it("is configured with HIGGSFIELD_API_KEY", () => {
    expect(createHiggsfieldClient({ HIGGSFIELD_API_KEY: "k" }, vi.fn(), noCliAuth).configured).toBe(
      true,
    );
  });

  it("is configured when the higgsfield CLI has an authenticated session", () => {
    expect(createHiggsfieldClient({}, vi.fn(), cliAuthed).configured).toBe(true);
  });

  it("generateAsset rejects with a 'not configured' error when neither is set", async () => {
    const client = createHiggsfieldClient({}, vi.fn(), noCliAuth);
    await expect(client.generateAsset("a cover image")).rejects.toThrow(HiggsfieldApiError);
    await expect(client.generateAsset("a cover image")).rejects.toThrow(/not configured/i);
  });

  it("generateAsset shells out to the higgsfield CLI and returns the printed asset URL", async () => {
    const exec = vi.fn().mockResolvedValue({
      stdout: "https://cdn.example/asset.png\n",
      stderr: "",
    });
    const client = createHiggsfieldClient({}, exec, cliAuthed);

    await expect(client.generateAsset("a vibrant cover image")).resolves.toEqual({
      url: "https://cdn.example/asset.png",
      type: "image",
    });
    expect(exec).toHaveBeenCalledWith([
      "generate",
      "create",
      "z_image",
      "--prompt",
      "a vibrant cover image",
      "--aspect_ratio",
      "9:16",
      "--wait",
    ]);
  });

  it("generateAsset throws when the CLI doesn't print an asset URL", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "Session expired" });
    const client = createHiggsfieldClient({}, exec, cliAuthed);

    await expect(client.generateAsset("a cover image")).rejects.toThrow(HiggsfieldApiError);
    await expect(client.generateAsset("a cover image")).rejects.toThrow(/Session expired/);
  });

  it("generateAsset wraps a CLI execution failure as a HiggsfieldApiError", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("spawn higgsfield ENOENT"));
    const client = createHiggsfieldClient({}, exec, cliAuthed);

    await expect(client.generateAsset("a cover image")).rejects.toThrow(HiggsfieldApiError);
    await expect(client.generateAsset("a cover image")).rejects.toThrow(/ENOENT/);
  });

  it("generateVideo shells out to seedance_2_0 with sensible vertical defaults", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "https://cdn.example/clip.mp4\n", stderr: "" });
    const client = createHiggsfieldClient({}, exec, cliAuthed);

    await expect(client.generateVideo({ prompt: "fast cuts of a desk setup" })).resolves.toEqual({
      url: "https://cdn.example/clip.mp4",
      type: "video",
    });
    expect(exec).toHaveBeenCalledWith([
      "generate",
      "create",
      "seedance_2_0",
      "--prompt",
      "fast cuts of a desk setup",
      "--duration",
      "8",
      "--aspect_ratio",
      "9:16",
      "--wait",
    ]);
  });

  it("generateVideo forwards start-image, audio, duration and aspect ratio when provided", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "https://cdn.example/clip.mp4\n", stderr: "" });
    const client = createHiggsfieldClient({}, exec, cliAuthed);

    await client.generateVideo({
      prompt: "anim",
      startImage: "job-123",
      audio: "/tmp/track.mp3",
      durationSec: 12,
      aspectRatio: "16:9",
    });
    expect(exec).toHaveBeenCalledWith([
      "generate",
      "create",
      "seedance_2_0",
      "--prompt",
      "anim",
      "--start-image",
      "job-123",
      "--audio",
      "/tmp/track.mp3",
      "--duration",
      "12",
      "--aspect_ratio",
      "16:9",
      "--wait",
    ]);
  });

  it("generateVideo resolves remote media refs (e.g. a cover URL) before passing them to the CLI", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "https://cdn.example/clip.mp4\n", stderr: "" });
    const resolveMedia = vi.fn(async (ref: string) =>
      ref.startsWith("http") ? "/tmp/downloaded.png" : ref,
    );
    const client = createHiggsfieldClient({}, exec, cliAuthed, resolveMedia);

    await client.generateVideo({ prompt: "anim", startImage: "https://cdn.example/cover.png" });

    expect(resolveMedia).toHaveBeenCalledWith("https://cdn.example/cover.png");
    const args = exec.mock.calls[0]![0] as string[];
    const idx = args.indexOf("--start-image");
    expect(args[idx + 1]).toBe("/tmp/downloaded.png");
  });

  it("generateVideo rejects with a 'not configured' error when Higgsfield is unconfigured", async () => {
    const client = createHiggsfieldClient({}, vi.fn(), noCliAuth);
    await expect(client.generateVideo({ prompt: "x" })).rejects.toThrow(/not configured/i);
  });

  it("generateVideo throws when the CLI doesn't print an asset URL", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "boom" });
    const client = createHiggsfieldClient({}, exec, cliAuthed);
    await expect(client.generateVideo({ prompt: "x" })).rejects.toThrow(/boom/);
  });
});
