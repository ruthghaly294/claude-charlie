import { execFile } from "node:child_process";
import type { CaptionCue } from "./captions";

/**
 * Transcribe a clip's audio into timed caption cues using faster-whisper. We
 * shell out to a tiny Python program (faster-whisper is a Python lib) and parse
 * its JSON. The exec is injectable so tests assert on argv + parsing without a
 * GPU or model download.
 */
export type TranscribeExec = (bin: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

const DEFAULT_MODEL = "base";

/** The Python program: load the model, transcribe, print segment JSON to stdout. */
export function buildWhisperProgram(model: string): string {
  return [
    "import sys, json",
    "from faster_whisper import WhisperModel",
    `m = WhisperModel("${model}", device="cpu", compute_type="int8")`,
    "segs, _ = m.transcribe(sys.argv[1])",
    'print(json.dumps([{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segs]))',
  ].join("\n");
}

/** Parse the Python program's stdout JSON into caption cues (tolerant of noise). */
export function parseWhisperOutput(stdout: string): CaptionCue[] {
  const match = stdout.match(/\[.*\]/s);
  if (!match) return [];
  let rows: unknown;
  try {
    rows = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => r as { start?: number; end?: number; text?: string })
    .filter((r) => typeof r.start === "number" && typeof r.end === "number" && (r.text ?? "").trim())
    .map((r) => ({ start: r.start!, end: r.end!, text: (r.text ?? "").trim() }));
}

function defaultExec(timeoutMs: number): TranscribeExec {
  return (bin, args) =>
    new Promise((resolve, reject) => {
      execFile(bin, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 16 }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message));
        else resolve({ stdout, stderr });
      });
    });
}

export type TranscribeOptions = {
  model?: string;
  exec?: TranscribeExec;
  timeoutMs?: number;
};

export async function transcribe(
  videoPath: string,
  opts: TranscribeOptions = {},
): Promise<CaptionCue[]> {
  const exec = opts.exec ?? defaultExec(opts.timeoutMs ?? 300_000);
  const program = buildWhisperProgram(opts.model ?? DEFAULT_MODEL);
  const { stdout } = await exec("python3", ["-c", program, videoPath]);
  return parseWhisperOutput(stdout);
}
