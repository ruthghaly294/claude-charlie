import { describe, it, expect, vi } from "vitest";
import {
  buildWhisperProgram,
  parseWhisperOutput,
  transcribe,
  type TranscribeExec,
} from "./transcribe";
import { captionCuesFromBeats } from "./captions";
import { composeReusedClip, type ReuseClipDeps } from "./reuseClip";

describe("transcribe", () => {
  it("builds a faster-whisper program for the chosen model", () => {
    expect(buildWhisperProgram("tiny")).toContain('WhisperModel("tiny"');
  });

  it("parses segment JSON, dropping empty/invalid rows", () => {
    const out = parseWhisperOutput(
      'noise [{"start":0,"end":1,"text":" hi "},{"start":1,"end":2,"text":""},{"start":2}] tail',
    );
    expect(out).toEqual([{ start: 0, end: 1, text: "hi" }]);
  });

  it("returns [] when there is no JSON array", () => {
    expect(parseWhisperOutput("model loaded, no output")).toEqual([]);
  });

  it("invokes python3 with -c and the video path", async () => {
    const exec = vi.fn<TranscribeExec>(async () => ({
      stdout: '[{"start":0,"end":1,"text":"hello"}]',
      stderr: "",
    }));
    const cues = await transcribe("/tmp/clip.mp4", { exec, model: "base" });
    expect(cues).toEqual([{ start: 0, end: 1, text: "hello" }]);
    const [bin, args] = exec.mock.calls[0]!;
    expect(bin).toBe("python3");
    expect(args[0]).toBe("-c");
    expect(args[2]).toBe("/tmp/clip.mp4");
  });
});

describe("captionCuesFromBeats", () => {
  it("spreads beats evenly across the duration", () => {
    expect(captionCuesFromBeats(["a", "b"], 10)).toEqual([
      { start: 0, end: 5, text: "a" },
      { start: 5, end: 10, text: "b" },
    ]);
  });
  it("returns [] for no beats or zero duration", () => {
    expect(captionCuesFromBeats([], 10)).toEqual([]);
    expect(captionCuesFromBeats(["a"], 0)).toEqual([]);
  });
});

describe("composeReusedClip", () => {
  function fakeDeps(): ReuseClipDeps & {
    reframe: ReturnType<typeof vi.fn>;
    burn: ReturnType<typeof vi.fn>;
  } {
    let n = 0;
    return {
      download: vi.fn(async () => "/tmp/src.mp4"),
      host: vi.fn(async (p: string) => `https://cdn/${p.replace(/\W/g, "")}`),
      writeSubtitle: vi.fn(async () => "/tmp/sub.srt"),
      tmpPath: vi.fn((ext: string) => `/tmp/out${n++}${ext}`),
      reframe: vi.fn(async (_i: string, o: string) => o),
      burn: vi.fn(async (_i: string, _s: string, o: string) => o),
      transcribeFn: vi.fn(async () => [{ start: 0, end: 1, text: "hi" }]),
    };
  }

  it("downloads, reframes, burns beats, and hosts", async () => {
    const deps = fakeDeps();
    const url = await composeReusedClip("https://stock/clip.mp4", deps, {
      reframe: "crop",
      captions: "beats",
      beats: ["one", "two"],
      durationSec: 8,
    });
    expect(deps.download).toHaveBeenCalledWith("https://stock/clip.mp4");
    expect(deps.reframe).toHaveBeenCalledOnce();
    expect(deps.writeSubtitle).toHaveBeenCalledOnce();
    expect(deps.burn).toHaveBeenCalledOnce();
    expect(url).toContain("https://cdn/");
  });

  it("skips reframe and captions when not requested", async () => {
    const deps = fakeDeps();
    await composeReusedClip("https://stock/clip.mp4", deps, { reframe: "none", captions: "none" });
    expect(deps.reframe).not.toHaveBeenCalled();
    expect(deps.burn).not.toHaveBeenCalled();
    expect(deps.host).toHaveBeenCalledWith("/tmp/src.mp4");
  });

  it("uses whisper transcription when captions mode is transcribe", async () => {
    const deps = fakeDeps();
    await composeReusedClip("https://stock/clip.mp4", deps, { captions: "transcribe" });
    expect(deps.transcribeFn).toHaveBeenCalledOnce();
    expect(deps.burn).toHaveBeenCalledOnce();
  });
});
