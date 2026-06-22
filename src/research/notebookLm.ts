import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { SpawnFn } from "./last30days";

export type NotebookLmEnv = Record<string, string | undefined>;

const DEFAULT_TIMEOUT_MS = 240_000;
const STDERR_TAIL_LINES = 20;

/**
 * Legacy cookie path the importer (scripts/refresh_notebooklm_auth.py) writes. The CLI
 * auto-migrates this into profiles/<profile>/storage_state.json on its first run, so after
 * any CLI invocation the cookies live at the profile path and this file is gone.
 */
export const DEFAULT_STORAGE_STATE = join(homedir(), ".notebooklm", "storage_state.json");

/** Where the CLI keeps cookies after migration: ~/.notebooklm/profiles/<profile>/storage_state.json. */
export function profileStatePath(env: NotebookLmEnv = process.env): string {
  return join(homedir(), ".notebooklm", "profiles", env.NOTEBOOKLM_PROFILE ?? "default", "storage_state.json");
}

const defaultSpawn: SpawnFn = (command, args, options) =>
  spawn(command, args, options) as unknown as ReturnType<SpawnFn>;

/** A distilled, evidence-grounded insight returned from a NotebookLM notebook. */
export type NotebookInsight = {
  /** the notebook this came from. */
  notebookId: string;
  /** the LLM-distilled insight body (grounded in the notebook's sources). */
  text: string;
  /** source titles/urls the notebook cited, if the CLI surfaced them. */
  citations: string[];
};

/**
 * Tolerant parse of the `notebooklm` CLI's JSON answer. The unofficial CLI's exact
 * field names are not contractual, so accept the common shapes (answer/text/response,
 * citations/sources/references) and normalize. Verify against the installed CLI.
 */
const citeObject = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  /** the installed CLI's `ask --json` emits references as { source_id, citation_number, cited_text, … }. */
  cited_text: z.string().optional(),
  citation_number: z.number().optional(),
});
const citeList = z.array(z.union([z.string(), citeObject]));
const answerSchema = z
  .object({
    answer: z.string().optional(),
    text: z.string().optional(),
    response: z.string().optional(),
    citations: citeList.optional(),
    sources: citeList.optional(),
    references: citeList.optional(),
  })
  .transform((r) => {
    const text = (r.answer ?? r.text ?? r.response ?? "").trim();
    const rawCites = r.citations ?? r.sources ?? r.references ?? [];
    const citations = rawCites
      .map((c) => {
        if (typeof c === "string") return c.trim();
        // Prefer a human title/url; fall back to the quoted source passage the CLI returns.
        const labelled = [c.title, c.url].filter(Boolean).join(" — ");
        if (labelled) return labelled;
        const snippet = c.cited_text?.trim() ?? "";
        const n = c.citation_number;
        return snippet ? (n ? `[${n}] ${snippet}` : snippet) : "";
      })
      .filter((c) => c.length > 0);
    return { text, citations };
  });

export type NotebookLmCliOptions = {
  env?: NotebookLmEnv;
  spawnFn?: SpawnFn;
  timeoutMs?: number;
};

function stderrTail(stderr: string): string {
  return stderr.trim().split("\n").slice(-STDERR_TAIL_LINES).join("\n");
}

/**
 * The `--storage` global option to pass, if any. Only set it when the operator gives an
 * explicit override (NOTEBOOKLM_STORAGE_STATE); otherwise pass nothing and let the CLI use
 * its active profile — which is where the migrated cookies actually live. Forcing the legacy
 * path here was the "no cookies"/"unverified" bug: migration deletes that file.
 */
export function storageArgs(env: NotebookLmEnv = process.env): string[] {
  return env.NOTEBOOKLM_STORAGE_STATE ? ["--storage", env.NOTEBOOKLM_STORAGE_STATE] : [];
}

/**
 * Configured ⇔ cookies exist on disk. With an explicit override we check that path; otherwise
 * we accept either the legacy import path or the migrated profile path (the CLI moves the
 * former to the latter on first run, so both are valid "cookies are present" signals).
 */
export function notebookLmConfigured(env: NotebookLmEnv = process.env): boolean {
  if (env.NOTEBOOKLM_STORAGE_STATE) return existsSync(env.NOTEBOOKLM_STORAGE_STATE);
  return existsSync(DEFAULT_STORAGE_STATE) || existsSync(profileStatePath(env));
}

/**
 * Run one `notebooklm` subcommand and resolve its stdout. Args are passed as a single
 * argv array (never shell-interpolated), mirroring runLast30Days's spawn safety.
 *
 * `--storage` (when present) is a global option that must precede the subcommand. By
 * default we omit it so the CLI authenticates with its active profile, where the migrated
 * cookies live; an explicit NOTEBOOKLM_STORAGE_STATE override is honored via storageArgs.
 */
function runCli(args: string[], opts: NotebookLmCliOptions = {}): Promise<string> {
  const env = opts.env ?? process.env;
  const spawnFn = opts.spawnFn ?? defaultSpawn;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const bin = env.NOTEBOOKLM_BIN ?? "notebooklm";
  const label = args[0];
  const fullArgs = [...storageArgs(env), ...args];

  const child = spawnFn(bin, fullArgs, { env });

  return new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error(`notebooklm ${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`notebooklm ${label} exited with code ${code}: ${stderrTail(stderr)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * `notebooklm auth check --json` → true when the storage state is present, well-formed,
 * and carries the required Google cookies. The bare (non-JSON) command exits 0 even when
 * it fails — it's a diagnostic — so we parse the machine-readable `status` field instead
 * of trusting the exit code. This is a local check (no network); pass --test for a token
 * fetch, but cookies-present is the "ready" signal the UI wants.
 */
export async function checkAuth(opts: NotebookLmCliOptions = {}): Promise<boolean> {
  try {
    const out = await runCli(["auth", "check", "--json"], { ...opts, timeoutMs: opts.timeoutMs ?? 15_000 });
    const parsed = JSON.parse(out) as { status?: string };
    return parsed.status === "ok";
  } catch {
    return false;
  }
}

/**
 * Add web links to a notebook as sources (used by `discovery` mode before querying).
 * The CLI takes a single CONTENT argument per `source add`, so we add one URL per call.
 */
export async function addSources(
  notebookId: string,
  urls: string[],
  opts: NotebookLmCliOptions = {},
): Promise<void> {
  const clean = urls.filter((u) => /^https?:\/\//.test(u));
  for (const u of clean) {
    await runCli(["source", "add", u, "-n", notebookId, "--type", "url"], opts);
  }
}

/**
 * Query a notebook with `prompt` and return its distilled, source-grounded answer.
 * Spawns `notebooklm ask --json -n <notebookId> <prompt>`; prompt is a single argv
 * element (never shell-interpolated). `--json` implies `--yes`, so it never blocks.
 */
export async function queryNotebook(
  notebookId: string,
  prompt: string,
  opts: NotebookLmCliOptions = {},
): Promise<NotebookInsight> {
  const stdout = await runCli(["ask", "--json", "-n", notebookId, prompt], opts);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new Error(`notebooklm chat produced invalid JSON: ${(err as Error).message}`);
  }

  const result = answerSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`notebooklm chat output failed validation: ${result.error.message}`);
  }
  if (!result.data.text) {
    throw new Error("notebooklm chat returned an empty answer");
  }
  return { notebookId, text: result.data.text, citations: result.data.citations };
}
