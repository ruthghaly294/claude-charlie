import type { DB } from "@/db/client";
import type { DecodeConfig } from "@/discovery/config";
import type { Connector } from "@/discovery/types";
import { runDiscovery } from "@/discovery/runDiscovery";
import { createLast30DaysConnector } from "@/discovery/connectors";
import { runDecode } from "@/discovery/runDecode";
import { getReasoner } from "@/discovery/claudeReasoner";
import { getCritic } from "@/discovery/critic";
import { UsageMeter } from "@/discovery/usage";
import { refreshEntities, getEntityRefreshClient } from "@/discovery/entityRefresh";
import { ingestReference } from "@/property/referenceIngest";
import { scrapeAllAgents } from "@/property/agentScrape";
import { enrichAllListings } from "@/property/listings";
import { loadSources } from "@/property/sources";
import { getExtractClient } from "@/property/llmExtract";
import { detectChanges } from "@/property/changeDetect";
import { runDecisionLifecycle } from "@/discovery/decisionLifecycle";
import { processEvents } from "@/events/bus";
import { createDealAlertHandlers } from "@/events/handlers/dealAlert";
import { createDecodeEventHandlers } from "@/events/handlers/decodeEvents";
import { buildNotifiers } from "@/notify/build";
import { runSeoAudit } from "@/seo/audit";
import { getReasonerClient } from "@/seo/reasoner";
import { upsertSite } from "@/seo/store";
import { runDigest } from "@/notify/digest";
import { createBufferClient, resolveOrgId } from "@/publishing/bufferClient";
import { collectPostPerformance } from "@/publishing/postFeedback";
import {
  runTrendImitationJob,
  runMusicTrendsJob,
  runSingleTrendRun,
  runTrendRenderResume,
} from "@/publishing/runTrendImitation";
import { runNotebookInsightJob } from "@/publishing/notebookInsight";

/** Every kind of work the job runner (src/jobs/runner.ts) can execute. */
export const JOB_KINDS = [
  "discovery",
  "decode",
  "property-scrape",
  "lps-enrich",
  "reference-ingest",
  "entity-refresh",
  "digest",
  "events-process",
  "decision-lifecycle",
  "post-performance",
  "social-research",
  "music-trends",
  "trend-imitation",
  "notebooklm-insight",
  "seo-audit",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export type JobContext = {
  db: DB;
  config: DecodeConfig;
  env: Record<string, string | undefined>;
  signal?: AbortSignal;
  /** test-only: inject fake connectors for the discovery job */
  connectors?: Connector[];
  /** test-only: inject a fake fetch for discovery/property jobs */
  fetchImpl?: typeof fetch;
};

export type JobDefinition = {
  kind: JobKind;
  run: (payload: unknown, ctx: JobContext) => Promise<void>;
  maxAttempts: number;
  backoffBaseMs: number;
  timeoutMs: number;
};

export type JobRegistry = Record<JobKind, JobDefinition>;

const MINUTE = 60_000;

/**
 * Build the production job registry, wiring each kind to its existing
 * pipeline entrypoint. `overrides` lets callers (tests, and Phase 5's
 * digest/events-process jobs) replace individual definitions.
 */
export function buildRegistry(overrides: Partial<JobRegistry> = {}): JobRegistry {
  const defaults: JobRegistry = {
    discovery: {
      kind: "discovery",
      run: async (_payload, ctx) => {
        await runDiscovery(ctx.db, ctx.config, {
          env: ctx.env,
          signal: ctx.signal,
          connectors: ctx.connectors,
          fetchImpl: ctx.fetchImpl,
        });
      },
      maxAttempts: 3,
      backoffBaseMs: 30_000,
      timeoutMs: 5 * MINUTE,
    },

    "social-research": {
      kind: "social-research",
      run: async (_payload, ctx) => {
        await runDiscovery(
          ctx.db,
          {
            ...ctx.config,
            robustness: { ...ctx.config.robustness, perSourceTimeoutMs: 270_000 },
          },
          {
            env: ctx.env,
            signal: ctx.signal,
            connectors: ctx.connectors ?? [createLast30DaysConnector()],
            fetchImpl: ctx.fetchImpl,
          },
        );
      },
      maxAttempts: 2,
      backoffBaseMs: 5 * MINUTE,
      timeoutMs: 6 * MINUTE,
    },

    decode: {
      kind: "decode",
      run: async (_payload, ctx) => {
        const meter = new UsageMeter();
        const reasoner = getReasoner(
          {
            businessName: ctx.config.businessName,
            businessDescription: ctx.config.businessDescription,
            profile: ctx.config.profile,
          },
          ctx.env,
          meter,
        );
        const critic = getCritic(ctx.env, meter);
        await runDecode(ctx.db, ctx.config, { reasoner, critic, meter });
      },
      maxAttempts: 3,
      backoffBaseMs: 60_000,
      timeoutMs: 10 * MINUTE,
    },

    "property-scrape": {
      kind: "property-scrape",
      run: async (_payload, ctx) => {
        const { extraction, geocode, sources, watch } = ctx.config.property;
        const summaries = await scrapeAllAgents(ctx.db, {
          agents: loadSources(sources),
          extractClient: extraction.llmRepair ? getExtractClient(ctx.env) : null,
          llmRepair: extraction.llmRepair,
          llmMaxPagesPerRun: extraction.llmMaxPagesPerRun,
          geocodeProviders: geocode.providers,
          fetchImpl: ctx.fetchImpl,
        });
        const seenListingIds = summaries.flatMap((s) => s.listingIds);
        detectChanges(ctx.db, seenListingIds, { watch });
      },
      maxAttempts: 2,
      backoffBaseMs: 5 * MINUTE,
      timeoutMs: 10 * MINUTE,
    },

    "lps-enrich": {
      kind: "lps-enrich",
      run: async (_payload, ctx) => {
        await enrichAllListings(ctx.db, { fetchImpl: ctx.fetchImpl });
      },
      maxAttempts: 2,
      backoffBaseMs: 5 * MINUTE,
      timeoutMs: 10 * MINUTE,
    },

    "reference-ingest": {
      kind: "reference-ingest",
      run: async (_payload, ctx) => {
        await ingestReference(ctx.db, { fetchImpl: ctx.fetchImpl });
      },
      maxAttempts: 2,
      backoffBaseMs: 5 * MINUTE,
      timeoutMs: 5 * MINUTE,
    },

    "entity-refresh": {
      kind: "entity-refresh",
      run: async (_payload, ctx) => {
        const meter = new UsageMeter();
        await refreshEntities(ctx.db, ctx.config, {
          client: getEntityRefreshClient(ctx.env),
          meter,
        });
      },
      maxAttempts: 2,
      backoffBaseMs: 5 * MINUTE,
      timeoutMs: 2 * MINUTE,
    },

    digest: {
      kind: "digest",
      run: async (_payload, ctx) => {
        const notifiers = buildNotifiers(ctx.config.notify, ctx.env);
        await runDigest(ctx.db, ctx.config, { notifiers });
      },
      maxAttempts: 2,
      backoffBaseMs: MINUTE,
      timeoutMs: MINUTE,
    },

    "events-process": {
      kind: "events-process",
      run: async (_payload, ctx) => {
        const handlers = {
          ...createDealAlertHandlers(ctx.db, ctx.config.notify),
          ...createDecodeEventHandlers(ctx.config.notify),
        };
        const notifiers = buildNotifiers(ctx.config.notify, ctx.env);
        await processEvents(ctx.db, handlers, notifiers);
      },
      maxAttempts: 3,
      backoffBaseMs: 5_000,
      timeoutMs: MINUTE,
    },

    "decision-lifecycle": {
      kind: "decision-lifecycle",
      run: async (_payload, ctx) => {
        await runDecisionLifecycle(ctx.db, ctx.config);
      },
      maxAttempts: 2,
      backoffBaseMs: 5 * MINUTE,
      timeoutMs: MINUTE,
    },

    "post-performance": {
      kind: "post-performance",
      run: async (_payload, ctx) => {
        const client = createBufferClient(ctx.env, ctx.fetchImpl);
        if (!client.configured) return;
        const orgId = await resolveOrgId(client);
        await collectPostPerformance(ctx.db, client, orgId);
      },
      maxAttempts: 2,
      backoffBaseMs: 5 * MINUTE,
      timeoutMs: 2 * MINUTE,
    },

    "music-trends": {
      kind: "music-trends",
      run: async (_payload, ctx) => {
        await runMusicTrendsJob(ctx.db, ctx.config);
      },
      maxAttempts: 2,
      backoffBaseMs: 5 * MINUTE,
      timeoutMs: 10 * MINUTE,
    },

    "trend-imitation": {
      kind: "trend-imitation",
      run: async (payload, ctx) => {
        // A web-triggered single run carries {runId, topic}; resuming a paused
        // review carries {runId, phase: "render"}; otherwise it's the scheduled
        // batch over every configured topic.
        const p = payload as
          | {
              runId?: string;
              topic?: string;
              assetStyle?: "standard" | "infographic";
              reviewEnabled?: boolean;
              coverModel?: string;
              videoModel?: string;
              overrides?: import("@/publishing/runTrendImitation").TrendRunOverrides;
              phase?: "render";
            }
          | null;
        if (p && typeof p.runId === "string" && p.phase === "render") {
          await runTrendRenderResume(ctx.db, ctx.config, ctx.env, p.runId);
        } else if (p && typeof p.runId === "string" && typeof p.topic === "string") {
          await runSingleTrendRun(ctx.db, ctx.config, ctx.env, {
            runId: p.runId,
            topic: p.topic,
            assetStyle: p.assetStyle,
            reviewEnabled: p.reviewEnabled,
            coverModel: p.coverModel,
            videoModel: p.videoModel,
            overrides: p.overrides,
          });
        } else {
          await runTrendImitationJob(ctx.db, ctx.config, ctx.env);
        }
      },
      maxAttempts: 2,
      backoffBaseMs: 5 * MINUTE,
      timeoutMs: 20 * MINUTE,
    },

    "notebooklm-insight": {
      kind: "notebooklm-insight",
      run: async (payload, ctx) => {
        const p = payload as { topics?: string[] } | null;
        await runNotebookInsightJob(ctx.db, ctx.config, ctx.env, p?.topics);
      },
      maxAttempts: 2,
      backoffBaseMs: 5 * MINUTE,
      timeoutMs: 10 * MINUTE,
    },

    "seo-audit": {
      kind: "seo-audit",
      run: async (_payload, ctx) => {
        const meter = new UsageMeter();
        const reasonerClient = getReasonerClient(ctx.env);
        const notifiers = buildNotifiers(ctx.config.notify, ctx.env);
        for (const input of ctx.config.seo.sites) {
          const site = upsertSite(ctx.db, input);
          await runSeoAudit(ctx.db, site, {
            reasonerClient,
            meter,
            notifiers,
            env: ctx.env,
            fetchImpl: ctx.fetchImpl,
            signal: ctx.signal,
            autoResolveAfterRuns: ctx.config.seo.autoResolveAfterRuns,
          });
        }
      },
      maxAttempts: 2,
      backoffBaseMs: 5 * MINUTE,
      timeoutMs: 10 * MINUTE,
    },
  };

  return { ...defaults, ...overrides };
}
