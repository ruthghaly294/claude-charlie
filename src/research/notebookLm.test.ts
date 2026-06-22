import { describe, it, expect, vi } from "vitest";
import type { SpawnFn, SpawnedProcess } from "./last30days";
import { queryNotebook, addSources, checkAuth } from "./notebookLm";

/** A fake child process that emits `stdout`, optional `stderr`, then closes with `code`. */
function fakeProcess(stdout: string, code = 0, stderr = ""): SpawnedProcess {
  return {
    stdout: { on: (_e, cb) => cb(Buffer.from(stdout)) },
    stderr: { on: (_e, cb) => cb(Buffer.from(stderr)) },
    on(event, listener) {
      if (event === "close") (listener as (c: number | null) => void)(code);
    },
    kill: () => {},
  };
}

/** Record spawn calls and reply with a canned process. */
function recordingSpawn(proc: SpawnedProcess): { spawnFn: SpawnFn; calls: { command: string; args: string[] }[] } {
  const calls: { command: string; args: string[] }[] = [];
  const spawnFn: SpawnFn = (command, args) => {
    calls.push({ command, args });
    return proc;
  };
  return { spawnFn, calls };
}

const env = { NOTEBOOKLM_STORAGE_STATE: "/tmp/does-not-matter.json" };

describe("queryNotebook", () => {
  it("passes the prompt as a single argv element and normalizes the answer", async () => {
    const { spawnFn, calls } = recordingSpawn(
      fakeProcess(JSON.stringify({ answer: "the angle is X", citations: ["Book A", { title: "Paper", url: "http://p" }] })),
    );

    const insight = await queryNotebook("nb-1", "distill an insight on AI agents", { env, spawnFn });

    expect(insight.text).toBe("the angle is X");
    expect(insight.citations).toEqual(["Book A", "Paper — http://p"]);
    expect(calls[0]!.command).toBe("notebooklm");
    expect(calls[0]!.args).toEqual([
      "--storage",
      "/tmp/does-not-matter.json",
      "ask",
      "--json",
      "-n",
      "nb-1",
      "distill an insight on AI agents",
    ]);
  });

  it("omits --storage when no explicit override is set (CLI uses its active profile)", async () => {
    const { spawnFn, calls } = recordingSpawn(fakeProcess(JSON.stringify({ answer: "x" })));
    await queryNotebook("nb-1", "p", { env: {}, spawnFn });
    expect(calls[0]!.args).toEqual(["ask", "--json", "-n", "nb-1", "p"]);
  });

  it("accepts alternate field names (text/sources)", async () => {
    const { spawnFn } = recordingSpawn(fakeProcess(JSON.stringify({ text: "alt", sources: ["S1"] })));
    const insight = await queryNotebook("nb-1", "p", { env, spawnFn });
    expect(insight.text).toBe("alt");
    expect(insight.citations).toEqual(["S1"]);
  });

  it("rejects an empty answer", async () => {
    const { spawnFn } = recordingSpawn(fakeProcess(JSON.stringify({ answer: "" })));
    await expect(queryNotebook("nb-1", "p", { env, spawnFn })).rejects.toThrow(/empty answer/);
  });

  it("rejects invalid JSON", async () => {
    const { spawnFn } = recordingSpawn(fakeProcess("not json"));
    await expect(queryNotebook("nb-1", "p", { env, spawnFn })).rejects.toThrow(/invalid JSON/);
  });

  it("rejects a non-zero exit with the stderr tail", async () => {
    const { spawnFn } = recordingSpawn(fakeProcess("", 1, "boom"));
    await expect(queryNotebook("nb-1", "p", { env, spawnFn })).rejects.toThrow(/exited with code 1: boom/);
  });
});

describe("addSources", () => {
  it("adds each http(s) url with its own `source add` call and skips non-urls", async () => {
    const { spawnFn, calls } = recordingSpawn(fakeProcess("ok"));
    await addSources("nb-1", ["https://a.com", "not-a-url", "http://b.com"], { env, spawnFn });
    expect(calls.map((c) => c.args)).toEqual([
      ["--storage", "/tmp/does-not-matter.json", "source", "add", "https://a.com", "-n", "nb-1", "--type", "url"],
      ["--storage", "/tmp/does-not-matter.json", "source", "add", "http://b.com", "-n", "nb-1", "--type", "url"],
    ]);
  });

  it("is a no-op (no spawn) when there are no valid urls", async () => {
    const spawnFn = vi.fn<SpawnFn>();
    await addSources("nb-1", ["nope"], { env, spawnFn });
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

describe("checkAuth", () => {
  it("requests JSON and returns true when status is ok", async () => {
    const { spawnFn, calls } = recordingSpawn(fakeProcess(JSON.stringify({ status: "ok" })));
    expect(await checkAuth({ env, spawnFn })).toBe(true);
    expect(calls[0]!.args).toEqual(["--storage", "/tmp/does-not-matter.json", "auth", "check", "--json"]);
  });

  it("returns false when status is error (the bare command exits 0 even on failure)", async () => {
    const { spawnFn } = recordingSpawn(fakeProcess(JSON.stringify({ status: "error" })));
    expect(await checkAuth({ env, spawnFn })).toBe(false);
  });

  it("returns false (no throw) when the CLI errors", async () => {
    const { spawnFn } = recordingSpawn(fakeProcess("", 1, "no cookies"));
    expect(await checkAuth({ env, spawnFn })).toBe(false);
  });
});
