import { defaultFfmpegExec, type FfmpegExec } from "./ffmpeg";

/** One caption cue: a span of text shown between `start` and `end` (seconds). */
export type CaptionCue = { start: number; end: number; text: string };

/** Format seconds as an SRT timestamp: HH:MM:SS,mmm. */
export function formatSrtTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const ms = Math.round(clamped * 1000);
  const hh = Math.floor(ms / 3_600_000);
  const mm = Math.floor((ms % 3_600_000) / 60_000);
  const ss = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)},${pad(millis, 3)}`;
}

/**
 * Distribute short on-screen-text beats evenly across the clip duration as
 * caption cues — used when there's no speech to transcribe (e.g. a stock B-roll
 * clip) but the brief still has on-screen text to burn in.
 */
export function captionCuesFromBeats(beats: string[], totalSec: number): CaptionCue[] {
  const clean = beats.map((b) => b.trim()).filter(Boolean);
  if (!clean.length || totalSec <= 0) return [];
  const per = totalSec / clean.length;
  return clean.map((text, i) => ({ start: i * per, end: (i + 1) * per, text }));
}

/** Render cues to an SRT document (pure — testable without ffmpeg). */
export function toSrt(cues: CaptionCue[]): string {
  return cues
    .map((cue, i) => {
      const idx = i + 1;
      const time = `${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}`;
      return `${idx}\n${time}\n${cue.text.trim()}\n`;
    })
    .join("\n");
}

/**
 * "Opus-style" caption look: bold white text, heavy black outline, lower-third
 * centered. Overridable via CaptionStyle. Values are libass `force_style` keys.
 */
export type CaptionStyle = {
  fontName?: string;
  fontSize?: number;
  bold?: boolean;
  /** libass &HBBGGRR */
  primaryColour?: string;
  outlineColour?: string;
  outline?: number;
  marginV?: number;
};

export function buildForceStyle(style: CaptionStyle = {}): string {
  const parts = [
    `Fontname=${style.fontName ?? "Arial"}`,
    `Fontsize=${style.fontSize ?? 18}`,
    `PrimaryColour=${style.primaryColour ?? "&H00FFFFFF"}`,
    `OutlineColour=${style.outlineColour ?? "&H00000000"}`,
    "BorderStyle=1",
    `Outline=${style.outline ?? 2}`,
    `Bold=${style.bold === false ? 0 : 1}`,
    "Alignment=2",
    `MarginV=${style.marginV ?? 60}`,
  ];
  return parts.join(",");
}

/**
 * Escape a path for use inside the ffmpeg `subtitles=` filter, where `:` and `'`
 * and `\` are filter-graph metacharacters.
 */
export function escapeSubtitlePath(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/** Build the ffmpeg argv that burns an SRT/ASS subtitle file onto the video. */
export function buildCaptionBurnArgs(
  input: string,
  subtitlePath: string,
  output: string,
  style: CaptionStyle = {},
): string[] {
  const filter = `subtitles=${escapeSubtitlePath(subtitlePath)}:force_style='${buildForceStyle(style)}'`;
  return ["-y", "-i", input, "-vf", filter, "-c:a", "copy", output];
}

export async function burnCaptions(
  input: string,
  subtitlePath: string,
  output: string,
  style: CaptionStyle = {},
  exec: FfmpegExec = defaultFfmpegExec(),
): Promise<string> {
  await exec("ffmpeg", buildCaptionBurnArgs(input, subtitlePath, output, style));
  return output;
}
