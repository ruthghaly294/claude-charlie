import { describe, it, expect, vi } from "vitest";
import {
  buildReframeFilter,
  buildReframeArgs,
  reframeToVertical,
  type ReframeMode,
} from "./reframe";
import {
  toSrt,
  formatSrtTime,
  buildCaptionBurnArgs,
  buildForceStyle,
  escapeSubtitlePath,
  burnCaptions,
} from "./captions";
import type { FfmpegExec } from "./ffmpeg";

describe("reframe", () => {
  it("center-crops to fill 1080x1920 by default", () => {
    const filter = buildReframeFilter("crop", 1080, 1920);
    expect(filter).toBe(
      "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
    );
  });

  it("builds a blurred-pad filter that overlays the fit source on a blurred bg", () => {
    const filter = buildReframeFilter("blur_pad", 1080, 1920);
    expect(filter).toContain("boxblur");
    expect(filter).toContain("force_original_aspect_ratio=decrease");
    expect(filter).toContain("overlay=(W-w)/2:(H-h)/2");
  });

  it("builds full argv with -y, input, filter, and copies audio", () => {
    const args = buildReframeArgs("in.mp4", "out.mp4");
    expect(args).toEqual([
      "-y",
      "-i",
      "in.mp4",
      "-filter_complex",
      "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
      "-c:a",
      "copy",
      "out.mp4",
    ]);
  });

  it.each<ReframeMode>(["crop", "blur_pad"])("invokes ffmpeg for mode %s", async (mode) => {
    const exec = vi.fn<FfmpegExec>(async () => ({ stdout: "", stderr: "" }));
    const result = await reframeToVertical("in.mp4", "out.mp4", { mode }, exec);
    expect(result).toBe("out.mp4");
    expect(exec).toHaveBeenCalledWith("ffmpeg", expect.arrayContaining(["-i", "in.mp4", "out.mp4"]));
  });
});

describe("captions", () => {
  it("formats SRT timestamps as HH:MM:SS,mmm", () => {
    expect(formatSrtTime(0)).toBe("00:00:00,000");
    expect(formatSrtTime(3661.5)).toBe("01:01:01,500");
    expect(formatSrtTime(-2)).toBe("00:00:00,000");
  });

  it("renders cues to a valid SRT document", () => {
    const srt = toSrt([
      { start: 0, end: 1.2, text: "hello" },
      { start: 1.2, end: 2.5, text: " world " },
    ]);
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:01,200\nhello");
    expect(srt).toContain("2\n00:00:01,200 --> 00:00:02,500\nworld");
  });

  it("defaults to a bold, outlined, lower-third opus style", () => {
    const style = buildForceStyle();
    expect(style).toContain("Bold=1");
    expect(style).toContain("Alignment=2");
    expect(style).toContain("Outline=2");
  });

  it("escapes filter metacharacters in the subtitle path", () => {
    expect(escapeSubtitlePath("/tmp/a:b'c")).toBe("/tmp/a\\:b\\'c");
  });

  it("builds caption-burn argv with the subtitles filter", () => {
    const args = buildCaptionBurnArgs("in.mp4", "/tmp/sub.srt", "out.mp4");
    const vf = args[args.indexOf("-vf") + 1]!;
    expect(vf).toContain("subtitles=/tmp/sub.srt");
    expect(vf).toContain("force_style=");
    expect(args).toContain("out.mp4");
  });

  it("invokes ffmpeg when burning captions", async () => {
    const exec = vi.fn<FfmpegExec>(async () => ({ stdout: "", stderr: "" }));
    const out = await burnCaptions("in.mp4", "/tmp/s.srt", "out.mp4", {}, exec);
    expect(out).toBe("out.mp4");
    expect(exec).toHaveBeenCalledOnce();
  });
});
