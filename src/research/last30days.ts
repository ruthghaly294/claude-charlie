import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export type ResearchItem = {
  title: string;
  url: string;
  snippet: string;
  author?: string;
  publishedAt?: string;
  engagement: Record<string, number>;
  /** thumbnail/preview image, when the source provides one or it's enriched later. */
  imageUrl?: string;
};

export type ResearchReport = {
  topic: string;
  rangeFrom: string;
  rangeTo: string;
  itemsBySource: Record<string, ResearchItem[]>;
  errorsBySource: Record<string, string>;
  warnings: string[];
};

export type RunLast30DaysOptions = {
  quick?: boolean;
};

export type RunLast30DaysEnv = Record<string, string | undefined>;

/** Minimal shape of a spawned child process — just enough to drive the pipeline. */
export type SpawnedProcess = {
  stdout: { on(event: "data", listener: (chunk: Buffer) => void): void } | null;
  stderr: { on(event: "data", listener: (chunk: Buffer) => void): void } | null;
  on(event: "close", listener: (code: number | null) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  kill(): void;
};

export type SpawnFn = (
  command: string,
  args: string[],
  options: Record<string, unknown>,
) => SpawnedProcess;

const defaultSpawn: SpawnFn = (command, args, options) =>
  spawn(command, args, options) as unknown as SpawnedProcess;

export const DEFAULT_SCRIPT_PATH = join(
  homedir(),
  ".claude/skills/last30days/scripts/last30days.py",
);

const TIMEOUT_MS = 240_000;
const MAX_ITEMS_PER_SOURCE = 10;
const STDERR_TAIL_LINES = 20;

const sourceItemSchema = z
  .object({
    title: z.string().default(""),
    url: z.string().default(""),
    snippet: z.string().default(""),
    author: z.string().optional(),
    published_at: z.string().optional(),
    engagement: z.record(z.string(), z.number()).default({}),
    image_url: z.string().optional(),
    thumbnail: z.string().optional(),
  })
  .transform((item) => ({
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    author: item.author,
    publishedAt: item.published_at,
    engagement: item.engagement,
    imageUrl: item.image_url ?? item.thumbnail,
  }));

const reportSchema = z
  .object({
    topic: z.string(),
    range_from: z.string(),
    range_to: z.string(),
    items_by_source: z.record(z.string(), z.array(sourceItemSchema)).default({}),
    errors_by_source: z.record(z.string(), z.string()).default({}),
    warnings: z.array(z.string()).default([]),
  })
  .transform((report) => ({
    topic: report.topic,
    rangeFrom: report.range_from,
    rangeTo: report.range_to,
    itemsBySource: report.items_by_source,
    errorsBySource: report.errors_by_source,
    warnings: report.warnings,
  }));

function engagementScore(item: ResearchItem): number {
  return Object.values(item.engagement).reduce((sum, n) => sum + n, 0);
}

function capAndSort(report: ResearchReport): ResearchReport {
  const itemsBySource: Record<string, ResearchItem[]> = {};
  for (const [source, items] of Object.entries(report.itemsBySource)) {
    itemsBySource[source] = [...items]
      .sort((a, b) => engagementScore(b) - engagementScore(a))
      .slice(0, MAX_ITEMS_PER_SOURCE);
  }
  return { ...report, itemsBySource };
}

function stderrTail(stderr: string): string {
  return stderr.trim().split("\n").slice(-STDERR_TAIL_LINES).join("\n");
}

/**
 * Run the last30days research CLI for `topic` and return its parsed report.
 * Spawns python with the topic as a single argv element (never shell-interpolated).
 */
export async function runLast30Days(
  topic: string,
  opts: RunLast30DaysOptions = {},
  env: RunLast30DaysEnv = process.env,
  spawnFn: SpawnFn = defaultSpawn,
): Promise<ResearchReport> {
  const script = env.LAST30DAYS_SCRIPT ?? DEFAULT_SCRIPT_PATH;
  const python = env.LAST30DAYS_PYTHON ?? "python3.12";
  const args = [script, topic, "--emit=json"];
  if (opts.quick) args.push("--quick");

  const child = spawnFn(python, args, { env });

  return new Promise<ResearchReport>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error(`last30days timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

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
        reject(new Error(`last30days exited with code ${code}: ${stderrTail(stderr)}`));
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch (err) {
        reject(new Error(`last30days produced invalid JSON: ${(err as Error).message}`));
        return;
      }

      const result = reportSchema.safeParse(parsed);
      if (!result.success) {
        reject(new Error(`last30days output failed validation: ${result.error.message}`));
        return;
      }

      resolve(capAndSort(result.data));
    });
  });
}
