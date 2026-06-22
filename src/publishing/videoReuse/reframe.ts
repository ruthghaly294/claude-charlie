import {
  defaultFfmpegExec,
  VERTICAL_HEIGHT,
  VERTICAL_WIDTH,
  type FfmpegExec,
} from "./ffmpeg";

/**
 * Reframe an existing clip to vertical 9:16 — the move that makes a borrowed
 * landscape/square clip feel native on Reels/TikTok/Shorts. Pattern lifted from
 * the OSS short-form tools (clipify / AI-Youtube-Shorts-Generator): either
 * center-crop to fill (default, punchy) or fit the source over a blurred,
 * scaled copy of itself (keeps the whole frame, "letterbox-with-blur" look).
 */
export type ReframeMode = "crop" | "blur_pad";

export type ReframeOptions = {
  mode?: ReframeMode;
  width?: number;
  height?: number;
};

/**
 * Build the ffmpeg `-vf` filter for the chosen reframe mode. Pure + exported so
 * it can be asserted in tests without running ffmpeg.
 */
export function buildReframeFilter(mode: ReframeMode, width: number, height: number): string {
  if (mode === "blur_pad") {
    // Blurred, cover-scaled background; the source fit (contain) and centered on top.
    return (
      `split[bg][fg];` +
      `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=40[bgb];` +
      `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[fgs];` +
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2`
    );
  }
  // crop: scale up to cover the frame, then center-crop the overflow.
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
}

/** Build the full ffmpeg argv for a reframe pass. */
export function buildReframeArgs(
  input: string,
  output: string,
  opts: ReframeOptions = {},
): string[] {
  const width = opts.width ?? VERTICAL_WIDTH;
  const height = opts.height ?? VERTICAL_HEIGHT;
  const filter = buildReframeFilter(opts.mode ?? "crop", width, height);
  return [
    "-y",
    "-i",
    input,
    "-filter_complex",
    filter,
    "-c:a",
    "copy",
    output,
  ];
}

export async function reframeToVertical(
  input: string,
  output: string,
  opts: ReframeOptions = {},
  exec: FfmpegExec = defaultFfmpegExec(),
): Promise<string> {
  await exec("ffmpeg", buildReframeArgs(input, output, opts));
  return output;
}
