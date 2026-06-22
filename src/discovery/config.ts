import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  DEFAULT_SOURCES as PROPERTY_DEFAULT_SOURCES,
  type PropertySource,
} from "@/property/sources";
import { DEFAULT_GEOCODE_PROVIDERS, type GeocodeProvider } from "@/property/geocode";
import type { WatchConfig } from "@/property/changeDetect";
import {
  entityKindSchema,
  DEFAULT_RESEARCH_CONFIG,
  type ResearchConfig,
  type SeedEntity,
} from "./research";
import { PLATFORMS, PUBLISH_PLATFORMS, type PublishPlatform } from "@/publishing/postGenerator";

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
  /** Brand voice/persona description threaded into post generation. */
  voice: string;
};

/** Property-intelligence config: agent registry, LLM repair budget, geocode fallback chain. */
export type PropertyConfig = {
  sources: PropertySource[];
  extraction: {
    llmRepair: boolean;
    llmMaxPagesPerRun: number;
  };
  geocode: {
    providers: GeocodeProvider[];
  };
  /** Thresholds for src/property/changeDetect.ts (price drops, deals, gone detection). */
  watch: WatchConfig;
};

/** A recurring job's interval and jitter, as consumed by src/jobs/runner.ts's `tick`. */
export type ScheduleConfig = {
  intervalMs: number;
  jitterPct: number;
};

/** Recurring job schedules, keyed by job kind (see src/jobs/registry.ts's JOB_KINDS). */
export type JobsConfig = {
  schedules: Record<string, ScheduleConfig>;
};

/** How loudly an event type should be surfaced to the operator. */
export type NotifySeverity = "low" | "medium" | "high";

/** Notification fan-out: which channels are enabled + per-event-type severity. */
export type NotifyConfig = {
  channels: string[];
  events: Record<string, NotifySeverity>;
};

/** Daily digest job: send hour (UTC) + which sections to render. */
export type DigestConfig = {
  hourUtc: number;
  sections: string[];
};

/** src/discovery/decisionLifecycle.ts: how long an "open" decision stays open before expiring. */
export type DecisionsConfig = {
  ttlDays: number;
};

/** Buffer channel IDs to bulk-queue generated post variants to, per platform. */
export type PublishingConfig = {
  channelsByPlatform: Partial<Record<PublishPlatform, string>>;
};

/** One website tracked by the SEO/GEO assistant (multi-site by design). */
export type SeoSiteConfig = {
  id?: string;
  label?: string;
  domain: string;
  competitors: string[];
  keywords: string[];
  maxPages: number;
};

/** SEO/GEO assistant config: tracked sites + how long unfixed to-dos persist. */
export type SeoConfig = {
  sites: SeoSiteConfig[];
  autoResolveAfterRuns: number;
};

/**
 * Standardized brand framework for the reproducible Question-of-the-Day format:
 * the handle, the fixed follow+save / signup CTAs, and the content pillars
 * (FRCR Physics subtopics) the post rotation cycles through. Threaded into the
 * brief builder so every post carries the same identity + CTA.
 */
export type BrandConfig = {
  /** Instagram handle, e.g. "@frcrbank". */
  handle: string;
  /** Brand name used in the post's operator/voice context. */
  name: string;
  /** One-line brand description for the brief's operator context. */
  description: string;
  /** Brand voice/persona for the caption + slide copy. */
  voice: string;
  /** Target audience for the post format. */
  audience: string;
  /** Signup/landing URL referenced by the "link in bio" CTA. */
  signupUrl: string;
  /** Primary CTA (follow + save). */
  ctaPrimary: string;
  /** Secondary CTA (signup / link in bio). */
  ctaSecondary: string;
  /** Content pillars / subtopics the rotation cycles through. */
  contentPillars: string[];
};

/**
 * Trend-imitation creative engine: short-form video defaults, the music layer,
 * and the pre-publish virality gate. Topic-agnostic — topics are supplied here
 * (for the scheduled job) or per run.
 */
export type TrendImitationConfig = {
  /** topics the scheduled `trend-imitation` job runs for; per-run callers override. */
  topics: string[];
  /** which media generator backs cover/video generation. */
  provider: "higgsfield" | "replicate" | "muapi";
  /** Replicate model ids (used when provider === "replicate"). videoEndImageKey enables a last-frame keyframe on models that accept one. */
  replicate: { imageModel: string; videoModel: string; videoImageKey: string; infographicModel: string; videoEndImageKey?: string };
  /** cover-image style: "standard" photo-style cover, or "infographic" (data-viz, via infographicModel). */
  assetStyle: "standard" | "infographic";
  /** video source: "generate" (synthesize), "stock" (license-cleared Pexels clip), or "duet" (commentary over a referenced clip, manual post). */
  sourceMode: "generate" | "stock" | "duet";
  /** burn the brief's on-screen text into reused (stock/duet) clips via ffmpeg. */
  captionOverlay: boolean;
  /** for sourceMode "duet": the public URL of the clip being reacted to (attribution + manual duet/stitch). */
  duetSourceUrl?: string;
  /** MuAPI model ids (used when provider === "muapi"). */
  muapi: { imageModel: string; videoModel: string };
  video: { aspectRatio: string; durationSec: number; model: string; endFrame: boolean };
  /** render N cover candidates and animate only the best-scoring one (1 = single cover, no scoring). */
  coverVariants: number;
  /** music evidence layer; provider is the default royalty-free source. */
  music: { enabled: boolean; provider: string };
  /** re-host generated media to a durable URL before scheduling ("r2" | "muapi" | "none"). */
  mediaHost: "r2" | "muapi" | "none";
  /** minimum Virality Predictor score (0–100) to auto-queue; below ⇒ draft for review. */
  viralityThreshold: number;
  /** run the Higgsfield virality score after rendering (slow; needs a paid plan). Off ⇒ straight to draft. */
  scoreVirality: boolean;
  /** which scorer runs when scoreVirality is on: "higgsfield" (vision, paid) or "llm" (owl-alpha brief score, free). */
  viralityScorer: "higgsfield" | "llm";
  /** minimum pre-generation idea-judge score (0–100) to spend on rendering; below ⇒ skip. */
  ideaThreshold: number;
  /** how many brief variants to generate in parallel and pick the best of (1 = single brief). */
  briefVariants: number;
  /** opt-in thumbnail/visual enrichment of exemplars (off by default; keeps CI hermetic). */
  visionEnrichment: boolean;
  /** per-run prompt-variant selection ({promptKey: variantId}); resolved into prompt overrides. Transient, not persisted in config YAML. */
  promptVariants?: Record<string, string>;
  /** per-run operator-pasted research used to ground the brief. Transient, not persisted in config YAML. */
  manualResearch?: string;
  /** create video posts as Buffer drafts (human review) rather than queueing live. */
  saveToDraft: boolean;
  /** standardized brand identity + content pillars for the reproducible post format. */
  brand: BrandConfig;
};

/**
 * NotebookLM insight layer: drive a Google NotebookLM notebook (via the unofficial
 * `notebooklm` CLI authenticated with imported cookies) to distill an insight that
 * feeds the brief builder. `discovery` mode pushes the run's discovered links into
 * the notebook first; `existing` mode queries a notebook the operator pre-filled.
 * The enable toggle + notebook id are operator-editable at runtime (DB-backed,
 * see notebooklm_settings) and override these defaults.
 */
export type NotebookLmConfig = {
  enabled: boolean;
  mode: "discovery" | "existing";
  /** target notebook for `existing` mode (and fallback for `discovery`). */
  notebookId: string;
  /** how many top-ranked discovered links to push as sources in `discovery` mode. */
  maxSources: number;
  cliTimeoutMs: number;
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
  /** Property-intelligence: agent registry, LLM repair budget, geocode fallback chain. */
  property: PropertyConfig;
  /** Query-expansion templates, per-connector caps, and per-author dedup cap. */
  research: ResearchConfig;
  /** Entities seeded into the entities table on each discovery run (idempotent). */
  seedEntities: SeedEntity[];
  /** Recurring job schedules for src/jobs/runner.ts's `tick`. */
  jobs: JobsConfig;
  /** Notification fan-out: enabled channels + per-event-type severity. */
  notify: NotifyConfig;
  /** Daily digest job: send hour (UTC) + which sections to render. */
  digest: DigestConfig;
  /** src/discovery/decisionLifecycle.ts thresholds. */
  decisions: DecisionsConfig;
  /** Buffer channel IDs to bulk-queue generated post variants to, per platform. */
  publishing: PublishingConfig;
  /** Trend-imitation creative engine (short-form video + music + virality gate). */
  trendImitation: TrendImitationConfig;
  /** NotebookLM insight layer (cookie-authed CLI → distilled insight for the brief). */
  notebooklm: NotebookLmConfig;
  /** SEO/GEO assistant: tracked sites + recommendation lifecycle. */
  seo: SeoConfig;
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
        voice: z.string().optional(),
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
    research: z
      .object({
        expansion_templates: z.array(z.string()).optional(),
        max_queries_per_connector: z.number().optional(),
        per_author_cap: z.number().optional(),
        semantic_rerank: z.boolean().optional(),
        web_research: z.boolean().optional(),
        rank: z
          .object({
            weights: z
              .object({
                relevance: z.number().optional(),
                engagement: z.number().optional(),
                recency: z.number().optional(),
              })
              .optional(),
            half_life_days: z.number().optional(),
            top_n: z.number().optional(),
          })
          .optional(),
        seed_entities: z
          .array(
            z.object({
              keyword: z.string(),
              kind: entityKindSchema,
              value: z.string(),
              weight: z.number().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
    property: z
      .object({
        sources: z
          .array(
            z.object({
              key: z.string(),
              name: z.string(),
              sitemapUrl: z.string(),
              include: z.array(z.string()),
              exclude: z.array(z.string()).optional(),
              schema: z.string().optional(),
              enabled: z.boolean(),
            }),
          )
          .optional(),
        extraction: z
          .object({
            llm_repair: z.boolean().optional(),
            llm_max_pages_per_run: z.number().optional(),
          })
          .optional(),
        geocode: z
          .object({
            providers: z.array(z.enum(["nominatim", "postcode-centroid"])).optional(),
          })
          .optional(),
        watch: z
          .object({
            price_drop_pct: z.number().optional(),
            deal_alert_pct: z.number().optional(),
            gone_after_misses: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    jobs: z
      .object({
        schedules: z
          .record(
            z.string(),
            z.object({
              interval_minutes: z.number().optional(),
              jitter_pct: z.number().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
    notify: z
      .object({
        channels: z.array(z.string()).optional(),
        events: z.record(z.string(), z.enum(["low", "medium", "high"])).optional(),
      })
      .optional(),
    digest: z
      .object({
        hour_utc: z.number().optional(),
        sections: z.array(z.string()).optional(),
      })
      .optional(),
    decisions: z.object({ ttl_days: z.number().optional() }).optional(),
    publishing: z
      .object({
        channels_by_platform: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
    trend_imitation: z
      .object({
        topics: z.array(z.string()).optional(),
        provider: z.enum(["higgsfield", "replicate", "muapi"]).optional(),
        replicate: z
          .object({
            image_model: z.string().optional(),
            video_model: z.string().optional(),
            video_image_key: z.string().optional(),
            video_end_image_key: z.string().optional(),
            infographic_model: z.string().optional(),
          })
          .optional(),
        asset_style: z.enum(["standard", "infographic"]).optional(),
        source_mode: z.enum(["generate", "stock", "duet"]).optional(),
        caption_overlay: z.boolean().optional(),
        duet_source_url: z.string().optional(),
        muapi: z
          .object({
            image_model: z.string().optional(),
            video_model: z.string().optional(),
          })
          .optional(),
        video: z
          .object({
            aspect_ratio: z.string().optional(),
            duration_sec: z.number().optional(),
            model: z.string().optional(),
            end_frame: z.boolean().optional(),
          })
          .optional(),
        cover_variants: z.number().optional(),
        music: z
          .object({
            enabled: z.boolean().optional(),
            provider: z.string().optional(),
          })
          .optional(),
        media_host: z.enum(["r2", "muapi", "none"]).optional(),
        virality_threshold: z.number().optional(),
        score_virality: z.boolean().optional(),
        virality_scorer: z.enum(["higgsfield", "llm"]).optional(),
        idea_threshold: z.number().optional(),
        brief_variants: z.number().optional(),
        vision_enrichment: z.boolean().optional(),
        save_to_draft: z.boolean().optional(),
        brand: z
          .object({
            handle: z.string().optional(),
            name: z.string().optional(),
            description: z.string().optional(),
            voice: z.string().optional(),
            audience: z.string().optional(),
            signup_url: z.string().optional(),
            cta_primary: z.string().optional(),
            cta_secondary: z.string().optional(),
            content_pillars: z.array(z.string()).optional(),
          })
          .optional(),
      })
      .optional(),
    notebooklm: z
      .object({
        enabled: z.boolean().optional(),
        mode: z.enum(["discovery", "existing"]).optional(),
        notebook_id: z.string().optional(),
        max_sources: z.number().optional(),
        cli_timeout_ms: z.number().optional(),
      })
      .optional(),
    seo: z
      .object({
        sites: z
          .array(
            z.object({
              id: z.string().optional(),
              label: z.string().optional(),
              domain: z.string(),
              competitors: z.array(z.string()).optional(),
              keywords: z.array(z.string()).optional(),
              max_pages: z.number().optional(),
            }),
          )
          .optional(),
        auto_resolve_after_runs: z.number().optional(),
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

/** Default thresholds for src/property/changeDetect.ts. */
export const DEFAULT_WATCH_CONFIG: WatchConfig = {
  priceDropPct: 3,
  dealAlertPct: 15,
  goneAfterMisses: 3,
};

const MINUTE = 60_000;

/** Default recurring schedules, applied by scripts/jobs-tick.ts via `tick`. */
export const DEFAULT_JOB_SCHEDULES: Record<string, ScheduleConfig> = {
  discovery: { intervalMs: 60 * MINUTE, jitterPct: 0.15 },
  "property-scrape": { intervalMs: 12 * 60 * MINUTE, jitterPct: 0.15 },
  decode: { intervalMs: 4 * 60 * MINUTE, jitterPct: 0.15 },
  "events-process": { intervalMs: 5 * MINUTE, jitterPct: 0.15 },
  "decision-lifecycle": { intervalMs: 24 * 60 * MINUTE, jitterPct: 0.15 },
  digest: { intervalMs: 24 * 60 * MINUTE, jitterPct: 0.15 },
  "post-performance": { intervalMs: 12 * 60 * MINUTE, jitterPct: 0.15 },
  "seo-audit": { intervalMs: 7 * 24 * 60 * MINUTE, jitterPct: 0.1 },
};

/** Default per-event-type severity, used by src/events/handlers/* to set notification priority. */
export const DEFAULT_NOTIFY_EVENTS: Record<string, NotifySeverity> = {
  "listing.deal": "high",
  "listing.price_drop": "medium",
  "listing.status_change": "low",
  "decode.insight_created": "low",
  "decode.execution_ready": "medium",
  "discovery.run_failed": "high",
  "source.breaker_opened": "medium",
};

export const DEFAULT_NOTIFY_CONFIG: NotifyConfig = {
  channels: ["console"],
  events: DEFAULT_NOTIFY_EVENTS,
};

export const DEFAULT_DIGEST_CONFIG: DigestConfig = {
  hourUtc: 7,
  sections: ["deals", "insights", "decisions", "health"],
};

export const DEFAULT_DECISIONS_CONFIG: DecisionsConfig = { ttlDays: 14 };

export const DEFAULT_TREND_IMITATION_CONFIG: TrendImitationConfig = {
  topics: [],
  provider: "higgsfield",
  replicate: {
    imageModel: "black-forest-labs/flux-schnell",
    videoModel: "minimax/video-01",
    videoImageKey: "first_frame_image",
    infographicModel: "google/nano-banana-pro",
  },
  assetStyle: "standard",
  sourceMode: "generate",
  captionOverlay: false,
  muapi: { imageModel: "flux-schnell", videoModel: "seedance-2" },
  video: { aspectRatio: "9:16", durationSec: 8, model: "seedance_2_0", endFrame: false },
  coverVariants: 1,
  music: { enabled: true, provider: "youtube_audio_library" },
  mediaHost: "none",
  viralityThreshold: 70,
  scoreVirality: false,
  viralityScorer: "higgsfield",
  ideaThreshold: 60,
  briefVariants: 1,
  visionEnrichment: false,
  saveToDraft: true,
  brand: {
    handle: "",
    name: "",
    description: "",
    voice: "",
    audience: "",
    signupUrl: "",
    ctaPrimary: "",
    ctaSecondary: "",
    contentPillars: [],
  },
};

export const DEFAULT_NOTEBOOKLM_CONFIG: NotebookLmConfig = {
  enabled: false,
  mode: "discovery",
  notebookId: "",
  maxSources: 10,
  cliTimeoutMs: 240_000,
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
  tiktok_sounds: { enabled: false },
  last30days: { enabled: false },
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
      voice: raw.profile?.voice ?? "",
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
    property: {
      sources: raw.property?.sources ?? PROPERTY_DEFAULT_SOURCES,
      extraction: {
        llmRepair: raw.property?.extraction?.llm_repair ?? true,
        llmMaxPagesPerRun: raw.property?.extraction?.llm_max_pages_per_run ?? 25,
      },
      geocode: {
        providers: raw.property?.geocode?.providers ?? DEFAULT_GEOCODE_PROVIDERS,
      },
      watch: {
        priceDropPct: raw.property?.watch?.price_drop_pct ?? DEFAULT_WATCH_CONFIG.priceDropPct,
        dealAlertPct: raw.property?.watch?.deal_alert_pct ?? DEFAULT_WATCH_CONFIG.dealAlertPct,
        goneAfterMisses:
          raw.property?.watch?.gone_after_misses ?? DEFAULT_WATCH_CONFIG.goneAfterMisses,
      },
    },
    jobs: {
      schedules: mergeSchedules(raw.jobs?.schedules),
    },
    notify: {
      channels: raw.notify?.channels ?? DEFAULT_NOTIFY_CONFIG.channels,
      events: { ...DEFAULT_NOTIFY_EVENTS, ...(raw.notify?.events ?? {}) },
    },
    digest: {
      hourUtc: raw.digest?.hour_utc ?? DEFAULT_DIGEST_CONFIG.hourUtc,
      sections: raw.digest?.sections ?? DEFAULT_DIGEST_CONFIG.sections,
    },
    decisions: {
      ttlDays: raw.decisions?.ttl_days ?? DEFAULT_DECISIONS_CONFIG.ttlDays,
    },
    publishing: {
      channelsByPlatform: pickPlatformChannels(raw.publishing?.channels_by_platform),
    },
    trendImitation: {
      topics: raw.trend_imitation?.topics ?? DEFAULT_TREND_IMITATION_CONFIG.topics,
      provider: raw.trend_imitation?.provider ?? DEFAULT_TREND_IMITATION_CONFIG.provider,
      replicate: {
        imageModel:
          raw.trend_imitation?.replicate?.image_model ??
          DEFAULT_TREND_IMITATION_CONFIG.replicate.imageModel,
        videoModel:
          raw.trend_imitation?.replicate?.video_model ??
          DEFAULT_TREND_IMITATION_CONFIG.replicate.videoModel,
        videoImageKey:
          raw.trend_imitation?.replicate?.video_image_key ??
          DEFAULT_TREND_IMITATION_CONFIG.replicate.videoImageKey,
        infographicModel:
          raw.trend_imitation?.replicate?.infographic_model ??
          DEFAULT_TREND_IMITATION_CONFIG.replicate.infographicModel,
        videoEndImageKey:
          raw.trend_imitation?.replicate?.video_end_image_key ??
          DEFAULT_TREND_IMITATION_CONFIG.replicate.videoEndImageKey,
      },
      assetStyle: raw.trend_imitation?.asset_style ?? DEFAULT_TREND_IMITATION_CONFIG.assetStyle,
      sourceMode: raw.trend_imitation?.source_mode ?? DEFAULT_TREND_IMITATION_CONFIG.sourceMode,
      captionOverlay:
        raw.trend_imitation?.caption_overlay ?? DEFAULT_TREND_IMITATION_CONFIG.captionOverlay,
      duetSourceUrl: raw.trend_imitation?.duet_source_url ?? undefined,
      muapi: {
        imageModel:
          raw.trend_imitation?.muapi?.image_model ?? DEFAULT_TREND_IMITATION_CONFIG.muapi.imageModel,
        videoModel:
          raw.trend_imitation?.muapi?.video_model ?? DEFAULT_TREND_IMITATION_CONFIG.muapi.videoModel,
      },
      video: {
        aspectRatio:
          raw.trend_imitation?.video?.aspect_ratio ??
          DEFAULT_TREND_IMITATION_CONFIG.video.aspectRatio,
        durationSec:
          raw.trend_imitation?.video?.duration_sec ??
          DEFAULT_TREND_IMITATION_CONFIG.video.durationSec,
        model: raw.trend_imitation?.video?.model ?? DEFAULT_TREND_IMITATION_CONFIG.video.model,
        endFrame:
          raw.trend_imitation?.video?.end_frame ?? DEFAULT_TREND_IMITATION_CONFIG.video.endFrame,
      },
      coverVariants:
        raw.trend_imitation?.cover_variants ?? DEFAULT_TREND_IMITATION_CONFIG.coverVariants,
      music: {
        enabled:
          raw.trend_imitation?.music?.enabled ?? DEFAULT_TREND_IMITATION_CONFIG.music.enabled,
        provider:
          raw.trend_imitation?.music?.provider ?? DEFAULT_TREND_IMITATION_CONFIG.music.provider,
      },
      mediaHost: raw.trend_imitation?.media_host ?? DEFAULT_TREND_IMITATION_CONFIG.mediaHost,
      viralityThreshold:
        raw.trend_imitation?.virality_threshold ??
        DEFAULT_TREND_IMITATION_CONFIG.viralityThreshold,
      scoreVirality:
        raw.trend_imitation?.score_virality ?? DEFAULT_TREND_IMITATION_CONFIG.scoreVirality,
      viralityScorer:
        raw.trend_imitation?.virality_scorer ?? DEFAULT_TREND_IMITATION_CONFIG.viralityScorer,
      ideaThreshold:
        raw.trend_imitation?.idea_threshold ?? DEFAULT_TREND_IMITATION_CONFIG.ideaThreshold,
      briefVariants:
        raw.trend_imitation?.brief_variants ?? DEFAULT_TREND_IMITATION_CONFIG.briefVariants,
      visionEnrichment:
        raw.trend_imitation?.vision_enrichment ??
        DEFAULT_TREND_IMITATION_CONFIG.visionEnrichment,
      saveToDraft:
        raw.trend_imitation?.save_to_draft ?? DEFAULT_TREND_IMITATION_CONFIG.saveToDraft,
      brand: {
        handle:
          raw.trend_imitation?.brand?.handle ?? DEFAULT_TREND_IMITATION_CONFIG.brand.handle,
        name: raw.trend_imitation?.brand?.name ?? DEFAULT_TREND_IMITATION_CONFIG.brand.name,
        description:
          raw.trend_imitation?.brand?.description ?? DEFAULT_TREND_IMITATION_CONFIG.brand.description,
        voice: raw.trend_imitation?.brand?.voice ?? DEFAULT_TREND_IMITATION_CONFIG.brand.voice,
        audience:
          raw.trend_imitation?.brand?.audience ?? DEFAULT_TREND_IMITATION_CONFIG.brand.audience,
        signupUrl:
          raw.trend_imitation?.brand?.signup_url ?? DEFAULT_TREND_IMITATION_CONFIG.brand.signupUrl,
        ctaPrimary:
          raw.trend_imitation?.brand?.cta_primary ?? DEFAULT_TREND_IMITATION_CONFIG.brand.ctaPrimary,
        ctaSecondary:
          raw.trend_imitation?.brand?.cta_secondary ??
          DEFAULT_TREND_IMITATION_CONFIG.brand.ctaSecondary,
        contentPillars:
          raw.trend_imitation?.brand?.content_pillars ??
          DEFAULT_TREND_IMITATION_CONFIG.brand.contentPillars,
      },
    },
    notebooklm: {
      enabled: raw.notebooklm?.enabled ?? DEFAULT_NOTEBOOKLM_CONFIG.enabled,
      mode: raw.notebooklm?.mode ?? DEFAULT_NOTEBOOKLM_CONFIG.mode,
      notebookId: raw.notebooklm?.notebook_id ?? DEFAULT_NOTEBOOKLM_CONFIG.notebookId,
      maxSources: raw.notebooklm?.max_sources ?? DEFAULT_NOTEBOOKLM_CONFIG.maxSources,
      cliTimeoutMs: raw.notebooklm?.cli_timeout_ms ?? DEFAULT_NOTEBOOKLM_CONFIG.cliTimeoutMs,
    },
    seo: {
      sites: (raw.seo?.sites ?? []).map((s) => ({
        id: s.id,
        label: s.label,
        domain: s.domain,
        competitors: s.competitors ?? [],
        keywords: s.keywords ?? [],
        maxPages: s.max_pages ?? 40,
      })),
      autoResolveAfterRuns: raw.seo?.auto_resolve_after_runs ?? 3,
    },
    research: {
      expansionTemplates:
        raw.research?.expansion_templates ?? DEFAULT_RESEARCH_CONFIG.expansionTemplates,
      maxQueriesPerConnector:
        raw.research?.max_queries_per_connector ?? DEFAULT_RESEARCH_CONFIG.maxQueriesPerConnector,
      perAuthorCap: raw.research?.per_author_cap ?? DEFAULT_RESEARCH_CONFIG.perAuthorCap,
      rankWeights: {
        relevance:
          raw.research?.rank?.weights?.relevance ?? DEFAULT_RESEARCH_CONFIG.rankWeights.relevance,
        engagement:
          raw.research?.rank?.weights?.engagement ?? DEFAULT_RESEARCH_CONFIG.rankWeights.engagement,
        recency:
          raw.research?.rank?.weights?.recency ?? DEFAULT_RESEARCH_CONFIG.rankWeights.recency,
      },
      halfLifeDays: raw.research?.rank?.half_life_days ?? DEFAULT_RESEARCH_CONFIG.halfLifeDays,
      topN: raw.research?.rank?.top_n ?? DEFAULT_RESEARCH_CONFIG.topN,
      semanticRerank: raw.research?.semantic_rerank ?? DEFAULT_RESEARCH_CONFIG.semanticRerank,
      webResearch: raw.research?.web_research ?? DEFAULT_RESEARCH_CONFIG.webResearch,
    },
    seedEntities: raw.research?.seed_entities ?? [],
  };
}

/** Merge configured schedule overrides over DEFAULT_JOB_SCHEDULES, filling
 * missing intervalMs/jitterPct for an overridden kind from its defaults. */
function mergeSchedules(
  overrides?: Record<string, { interval_minutes?: number; jitter_pct?: number }>,
): Record<string, ScheduleConfig> {
  const merged: Record<string, ScheduleConfig> = {
    ...Object.fromEntries(
      Object.entries(DEFAULT_JOB_SCHEDULES).map(([k, v]) => [k, { ...v }]),
    ),
  };
  for (const [kind, sched] of Object.entries(overrides ?? {})) {
    const base = merged[kind] ?? { intervalMs: 60 * MINUTE, jitterPct: 0.15 };
    merged[kind] = {
      intervalMs:
        sched.interval_minutes !== undefined ? sched.interval_minutes * MINUTE : base.intervalMs,
      jitterPct: sched.jitter_pct ?? base.jitterPct,
    };
  }
  return merged;
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

/** Keep only entries whose key is a known Platform, dropping unrecognized ones. */
function pickPlatformChannels(
  input?: Record<string, string>,
): Partial<Record<PublishPlatform, string>> {
  const out: Partial<Record<PublishPlatform, string>> = {};
  for (const p of PUBLISH_PLATFORMS) {
    const v = input?.[p];
    if (v) out[p] = v;
  }
  return out;
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
