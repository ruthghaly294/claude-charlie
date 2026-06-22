import { reframeToVertical, type ReframeMode } from "./reframe";
import {
  burnCaptions,
  captionCuesFromBeats,
  toSrt,
  type CaptionCue,
  type CaptionStyle,
} from "./captions";
import { transcribe } from "./transcribe";

/**
 * Turn a borrowed/stock clip into a finished vertical, captioned asset:
 * download → (reframe to 9:16) → (burn captions) → host. Every side-effecting
 * step is injected so the orchestration is unit-testable with fakes, and so the
 * default wiring can reuse the existing media-download / R2-host helpers.
 */
export type ReuseClipDeps = {
  /** remote URL → local file path */
  download: (url: string) => Promise<string>;
  /** local file path → durable hosted URL */
  host: (path: string) => Promise<string>;
  /** write a subtitle document to a temp file, returning its path */
  writeSubtitle: (srt: string) => Promise<string>;
  /** allocate a temp output path with the given extension */
  tmpPath: (ext: string) => string;
  reframe?: typeof reframeToVertical;
  burn?: typeof burnCaptions;
  transcribeFn?: typeof transcribe;
};

export type ReuseClipOptions = {
  /** reframe mode, or "none" to skip (e.g. the source is already 9:16). */
  reframe?: ReframeMode | "none";
  /** caption source: none, the brief's on-screen beats, or whisper transcription. */
  captions?: "none" | "beats" | "transcribe";
  beats?: string[];
  durationSec?: number;
  captionStyle?: CaptionStyle;
};

export async function composeReusedClip(
  sourceUrl: string,
  deps: ReuseClipDeps,
  opts: ReuseClipOptions = {},
): Promise<string> {
  const reframe = deps.reframe ?? reframeToVertical;
  const burn = deps.burn ?? burnCaptions;
  const transcribeFn = deps.transcribeFn ?? transcribe;

  let working = await deps.download(sourceUrl);

  if (opts.reframe && opts.reframe !== "none") {
    const out = deps.tmpPath(".mp4");
    working = await reframe(working, out, { mode: opts.reframe });
  }

  if (opts.captions && opts.captions !== "none") {
    let cues: CaptionCue[] = [];
    if (opts.captions === "transcribe") {
      cues = await transcribeFn(working);
    } else {
      cues = captionCuesFromBeats(opts.beats ?? [], opts.durationSec ?? 0);
    }
    if (cues.length) {
      const subPath = await deps.writeSubtitle(toSrt(cues));
      const out = deps.tmpPath(".mp4");
      working = await burn(working, subPath, out, opts.captionStyle ?? {});
    }
  }

  return deps.host(working);
}
