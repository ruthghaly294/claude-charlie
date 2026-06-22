import { describe, it, expect, vi } from "vitest";
import { scoreVideo, passesViralityGate, HiggsfieldApiError } from "./viralityScore";

const cliAuthed = () => true;
const noCliAuth = () => false;

describe("scoreVideo", () => {
  it("shells out to brain_activity with the video reference and --wait", async () => {
    const exec = vi.fn().mockResolvedValue({
      stdout: "Overall score: 82/100\nPeak second: 3\nOpen report: https://app.example/report/abc\n",
      stderr: "",
    });
    const report = await scoreVideo("/tmp/clip.mp4", { exec, hasCliAuth: cliAuthed, env: {} });

    expect(exec).toHaveBeenCalledWith([
      "generate",
      "create",
      "brain_activity",
      "--video",
      "/tmp/clip.mp4",
      "--wait",
    ]);
    expect(report.score).toBe(82);
    expect(report.reportUrl).toBe("https://app.example/report/abc");
    expect(report.raw).toContain("Overall score");
  });

  it("parses a percentage-style score", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "Virality: 47%", stderr: "" });
    const report = await scoreVideo("job-1", { exec, hasCliAuth: cliAuthed, env: {} });
    expect(report.score).toBe(47);
  });

  it("resolves a remote video URL to a local path before passing --video", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "Overall: 70/100", stderr: "" });
    const resolveMedia = vi.fn(async (ref: string) =>
      ref.startsWith("http") ? "/tmp/clip.mp4" : ref,
    );
    await scoreVideo("https://cdn/clip.mp4", { exec, hasCliAuth: cliAuthed, env: {}, resolveMedia });
    expect(resolveMedia).toHaveBeenCalledWith("https://cdn/clip.mp4");
    expect(exec).toHaveBeenCalledWith(["generate", "create", "brain_activity", "--video", "/tmp/clip.mp4", "--wait"]);
  });

  it("returns a null score (not a throw) when no number is present", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "report generated, see link", stderr: "" });
    const report = await scoreVideo("job-1", { exec, hasCliAuth: cliAuthed, env: {} });
    expect(report.score).toBeNull();
  });

  it("rejects when Higgsfield is not configured", async () => {
    await expect(
      scoreVideo("job-1", { exec: vi.fn(), hasCliAuth: noCliAuth, env: {} }),
    ).rejects.toThrow(HiggsfieldApiError);
  });

  it("wraps a CLI failure as a HiggsfieldApiError", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("ENOENT"));
    await expect(
      scoreVideo("job-1", { exec, hasCliAuth: cliAuthed, env: {} }),
    ).rejects.toThrow(/ENOENT/);
  });
});

describe("passesViralityGate", () => {
  it("passes when the score meets or exceeds the threshold", () => {
    expect(passesViralityGate({ score: 70, reportUrl: null, raw: "" }, 70)).toBe(true);
    expect(passesViralityGate({ score: 69, reportUrl: null, raw: "" }, 70)).toBe(false);
  });

  it("does not pass an unknown (null) score — route to human review instead", () => {
    expect(passesViralityGate({ score: null, reportUrl: null, raw: "" }, 70)).toBe(false);
  });
});
