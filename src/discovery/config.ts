import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/** The four decision lanes recommendations are sorted into. */
export const LANES = ["product", "content", "marketing", "strategic"] as const;
export type Lane = (typeof LANES)[number];

/** Sellable formats the Package stage can produce from a ready execution. */
export const MONETIZATION_FORMATS = [
  "newsletter",
  "download",
  "thread",
  "file",
] as const;
export type MonetizationFormat = (typeof MONETIZATION_FORMATS)[number];

/** Per-domain requests/second + max concurrent in-flight requests. */
export type RateLimitConfig = {
  rps: number;
  concurrency: number;
};

/** Discovery-run robustness: per-source timeouts, fan-out cap, breaker, rate limits. */
export type RobustnessConfig = {
  perSourceTimeoutMs: number;
  maxParallelSources: number;
  breaker: { failureThreshold: number; cooldownMs: number };
  rateLimits: Record<string, RateLimitConfig>;
};

/** Who the operator is — threaded into reasoning + scoring so output fits them. */
export type OperatorProfile = {
  goals: string[];
  weeklyHours: number;
  skills: string[];
  risk: "low" | "medium" | "high";
  monetizationTarget: string;
  audience: string;
};

export type DecodeConfig = {
  vault: string;
  businessName: string;
  businessDescription: string;
  keywords: string[];
  competitors: string[];
  keepThreshold: number;
  topN: number;
  /** Observe ignores clusters with fewer than this many signals. */
  minClusterSize: number;
  /** Optional cluster→lane overrides used by Decide; otherwise lanes round-robin. */
  clusterLanes: Record<string, Lane>;
  /** The operator this OS works for. */
  profile: OperatorProfile;
  /** Which sellable formats the Package stage emits. */
  monetization: MonetizationFormat[];
  /** Minimum critic score (1–5) for an execution draft to be marked "ready". */
  qualityThreshold: number;
  sources: Record<string, unknown>;
  /** Discovery-run fan-out/timeout/breaker/rate-limit tuning. */
  robustness: RobustnessConfig;
};

const rawConfigSchema = z
  .object({
    vault: z.string().optional(),
    business: z
      .object({
        name: z.string().optional(),
        description: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        competitors: z.array(z.string()).optional(),
      })
      .optional(),
    scoring: z.object({ keep_threshold: z.number().optional() }).optional(),
    observe: z.object({ min_cluster_size: z.number().optional() }).optional(),
    decide: z
      .object({ cluster_lanes: z.record(z.string(), z.enum(LANES)).optional() })
      .optional(),
    execute: z.object({ top_n: z.number().optional() }).optional(),
    profile: z
      .object({
        goals: z.array(z.string()).optional(),
        weekly_hours: z.number().optional(),
        skills: z.array(z.string()).optional(),
        risk: z.enum(["low", "medium", "high"]).optional(),
        monetization_target: z.string().optional(),
        audience: z.string().optional(),
      })
      .optional(),
    monetization: z.array(z.enum(MONETIZATION_FORMATS)).optional(),
    quality: z.object({ threshold: z.number().optional() }).optional(),
    sources: z.record(z.string(), z.unknown()).optional(),
    robustness: z
      .object({
        per_source_timeout_ms: z.number().optional(),
        max_parallel_sources: z.number().optional(),
        breaker: z
          .object({
            failure_threshold: z.number().optional(),
            cooldown_minutes: z.number().optional(),
          })
          .optional(),
        rate_limits: z
          .record(
            z.string(),
            z.object({
              rps: z.number().optional(),
              concurrency: z.number().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
  })
  .passthrough();

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** Default per-domain rate limits; "default" applies to any domain without its own entry. */
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  default: { rps: 1, concurrency: 2 },
  "api.github.com": { rps: 2, concurrency: 4 },
  "nominatim.openstreetmap.org": { rps: 1, concurrency: 1 },
};

export const DEFAULT_SOURCES: Record<string, unknown> = {
  rss: ["https://hnrss.org/frontpage"],
  github_trending: { topics: ["ai-agents"], window: "weekly" },
  reddit: { subreddits: ["programming"] },
  hackernews: { query: "" },
  youtube: { queries: [] },
  google_cse: { enabled: false },
  twitter: { enabled: false },
  producthunt: { enabled: false },
};

/** Normalize a parsed YAML object (or anything) into a complete DecodeConfig. */
export function parseConfig(input: unknown): DecodeConfig {
  const parsed = rawConfigSchema.safeParse(input ?? {});
  const raw = parsed.success ? parsed.data : {};
  return {
    vault: expandHome(raw.vault ?? join(homedir(), "second-brain")),
    businessName: raw.business?.name ?? "My Business",
    businessDescription: raw.business?.description ?? "",
    keywords: raw.business?.keywords ?? [],
    competitors: raw.business?.competitors ?? [],
    keepThreshold: raw.scoring?.keep_threshold ?? 0.35,
    topN: raw.execute?.top_n ?? 3,
    minClusterSize: raw.observe?.min_cluster_size ?? 1,
    clusterLanes: raw.decide?.cluster_lanes ?? {},
    profile: {
      goals: raw.profile?.goals ?? [],
      weeklyHours: raw.profile?.weekly_hours ?? 10,
      skills: raw.profile?.skills ?? [],
      risk: raw.profile?.risk ?? "medium",
      monetizationTarget: raw.profile?.monetization_target ?? "",
      audience: raw.profile?.audience ?? "",
    },
    monetization: raw.monetization ?? ["newsletter", "thread", "file"],
    qualityThreshold: raw.quality?.threshold ?? 3.5,
    sources:
      raw.sources && Object.keys(raw.sources).length > 0
        ? raw.sources
        : DEFAULT_SOURCES,
    robustness: {
      perSourceTimeoutMs: raw.robustness?.per_source_timeout_ms ?? 20_000,
      maxParallelSources: raw.robustness?.max_parallel_sources ?? 6,
      breaker: {
        failureThreshold: raw.robustness?.breaker?.failure_threshold ?? 3,
        cooldownMs: (raw.robustness?.breaker?.cooldown_minutes ?? 60) * 60_000,
      },
      rateLimits: mergeRateLimits(raw.robustness?.rate_limits),
    },
  };
}

/** Merge configured per-domain rate limits over DEFAULT_RATE_LIMITS, filling
 * missing rps/concurrency from that domain's (or "default"'s) values. */
function mergeRateLimits(
  overrides?: Record<string, { rps?: number; concurrency?: number }>,
): Record<string, RateLimitConfig> {
  const merged: Record<string, RateLimitConfig> = {
    ...Object.fromEntries(
      Object.entries(DEFAULT_RATE_LIMITS).map(([k, v]) => [k, { ...v }]),
    ),
  };
  for (const [domain, lim] of Object.entries(overrides ?? {})) {
    const base = merged[domain] ?? merged.default!;
    merged[domain] = {
      rps: lim.rps ?? base.rps,
      concurrency: lim.concurrency ?? base.concurrency,
    };
  }
  return merged;
}

/** Resolve the config file path: DECODE_CONFIG, else <vault>/decode.config.yml. */
export function resolveConfigPath(): string {
  if (process.env.DECODE_CONFIG) return process.env.DECODE_CONFIG;
  return join(homedir(), "second-brain", "decode.config.yml");
}

/** Load config from disk; returns sensible defaults if the file is absent. */
export function loadConfig(path: string = resolveConfigPath()): DecodeConfig {
  if (!existsSync(path)) return parseConfig({});
  try {
    return parseConfig(parseYaml(readFileSync(path, "utf8")));
  } catch {
    return parseConfig({});
  }
}

/** Read the per-source config block, always returning an object. */
export function sourceConfig(
  cfg: DecodeConfig,
  key: string,
): Record<string, unknown> {
  const block = cfg.sources[key];
  return block && typeof block === "object" && !Array.isArray(block)
    ? (block as Record<string, unknown>)
    : {};
}
