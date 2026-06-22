import { execFile } from "node:child_process";

/**
 * Thin, injectable ffmpeg/ffprobe runner — mirrors the Higgsfield CLI seam
 * (`HiggsfieldExec`) so the video-reuse pipeline is unit-testable: tests pass a
 * fake exec and assert on the argv we build, without spawning real ffmpeg.
 */
export type FfmpegExecResult = { stdout: string; stderr: string };
export type FfmpegExec = (bin: string, args: string[]) => Promise<FfmpegExecResult>;

export class FfmpegError extends Error {}

const DEFAULT_TIMEOUT_MS = 300_000;

export function defaultFfmpegExec(timeoutMs = DEFAULT_TIMEOUT_MS): FfmpegExec {
  return (bin, args) =>
    new Promise((resolve, reject) => {
      execFile(bin, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 16 }, (error, stdout, stderr) => {
        if (error) reject(new FfmpegError(stderr.trim() || error.message));
        else resolve({ stdout, stderr });
      });
    });
}

/** Vertical short-form target: 1080×1920 (9:16), the Reels/TikTok/Shorts native frame. */
export const VERTICAL_WIDTH = 1080;
export const VERTICAL_HEIGHT = 1920;
