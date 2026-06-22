import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { HiggsfieldApiError } from "./higgsfieldClient";
import type { HiggsfieldExec, HiggsfieldExecResult } from "./higgsfieldClient";
import { resolveLocalMedia } from "./mediaDownload";

export { HiggsfieldApiError };

/** Higgsfield Virality Predictor (`brain_activity`) score for a finished clip. */
export type ViralityReport = {
  /** 0–100 attention/virality proxy, or null when the report carried no parseable number. */
  score: number | null;
  /** "Open report" link, when present. */
  reportUrl: string | null;
  /** Full CLI text output, retained for the dashboard / debugging. */
  raw: string;
};

export type ScoreVideoOptions = {
  exec?: HiggsfieldExec;
  hasCliAuth?: () => boolean;
  env?: Record<string, string | undefined>;
  /** resolve a remote video URL to a local path the CLI accepts (injected in tests). */
  resolveMedia?: (ref: string) => Promise<string>;
};

const VIRALITY_MODEL = "brain_activity";

function defaultExec(args: string[]): Promise<HiggsfieldExecResult> {
  return new Promise((resolve, reject) => {
    execFile("higgsfield", args, { timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve({ stdout, stderr });
    });
  });
}

function defaultHasCliAuth(): boolean {
  return existsSync(join(homedir(), ".config", "higgsfield", "credentials.json"));
}

/** First number that reads like a score: "82/100", "82%", or "score: 82". 0–100 only. */
function parseScore(output: string): number | null {
  const patterns = [
    /(\d{1,3})\s*\/\s*100/,
    /(\d{1,3}(?:\.\d+)?)\s*%/,
    /\bscore[:\s]+(\d{1,3}(?:\.\d+)?)/i,
  ];
  for (const re of patterns) {
    const m = output.match(re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 100) return Math.round(n);
    }
  }
  return null;
}

function parseReportUrl(output: string): string | null {
  return output.match(/https?:\/\/\S+/)?.[0] ?? null;
}

/**
 * Score a finished video with Higgsfield's Virality Predictor (`brain_activity`),
 * a video-in/text-out attention proxy. `videoRef` is a local path or a Higgsfield
 * job/upload id (the CLI auto-uploads paths). Used as a pre-publish QA gate.
 */
export async function scoreVideo(
  videoRef: string,
  opts: ScoreVideoOptions = {},
): Promise<ViralityReport> {
  const exec = opts.exec ?? defaultExec;
  const hasCliAuth = opts.hasCliAuth ?? defaultHasCliAuth;
  const env = opts.env ?? process.env;
  const resolveMedia = opts.resolveMedia ?? ((ref: string) => resolveLocalMedia(ref));

  const configured = Boolean(env.HIGGSFIELD_API_KEY) || hasCliAuth();
  if (!configured) {
    throw new HiggsfieldApiError(
      "Higgsfield is not configured (run `higgsfield auth login` or set HIGGSFIELD_API_KEY)",
    );
  }

  // The CLI's --video accepts a path/UUID, not a URL — download remote clips first.
  const localVideo = await resolveMedia(videoRef);

  let result: HiggsfieldExecResult;
  try {
    result = await exec(["generate", "create", VIRALITY_MODEL, "--video", localVideo, "--wait"]);
  } catch (err) {
    throw new HiggsfieldApiError(
      `Higgsfield virality scoring failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const out = result.stdout || result.stderr;
  return { score: parseScore(out), reportUrl: parseReportUrl(out), raw: out };
}

/**
 * Gate decision: a clip passes only when it has a known score at/above the
 * threshold. An unknown (null) score does NOT pass — those route to human review.
 */
export function passesViralityGate(report: ViralityReport, threshold: number): boolean {
  return report.score !== null && report.score >= threshold;
}
