import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { insights, notebooklmSettings } from "@/db/schema";
import type { DecodeConfig } from "@/discovery/config";
import {
  addSources,
  queryNotebook,
  notebookLmConfigured,
  type NotebookInsight,
} from "@/research/notebookLm";
import { resolvePrompt, loadPromptOverrides } from "./prompts";

/** The NotebookLM seam the orchestration depends on — injected as a fake in tests. */
export type NotebookLmClient = {
  /** cookies imported & storage state present. */
  configured: boolean;
  addSources(notebookId: string, urls: string[]): Promise<void>;
  query(notebookId: string, prompt: string): Promise<NotebookInsight>;
};

/** Real client backed by the `notebooklm` CLI (storage_state.json cookie auth). */
export function makeNotebookLmClient(
  env: Record<string, string | undefined> = process.env,
  timeoutMs?: number,
): NotebookLmClient {
  return {
    configured: notebookLmConfigured(env),
    addSources: (notebookId, urls) => addSources(notebookId, urls, { env, timeoutMs }),
    query: (notebookId, prompt) => queryNotebook(notebookId, prompt, { env, timeoutMs }),
  };
}

/** Effective settings: the DB row (operator-edited) overrides decode.config.yml defaults. */
export type ResolvedNotebookLmSettings = {
  enabled: boolean;
  mode: "discovery" | "existing";
  notebookId: string;
  maxSources: number;
};

/** Merge the operator's DB settings over the config defaults. */
export function resolveNotebookLmSettings(db: DB, config: DecodeConfig): ResolvedNotebookLmSettings {
  const row = db.select().from(notebooklmSettings).where(eq(notebooklmSettings.id, "default")).get();
  const base = config.notebooklm;
  return {
    enabled: row?.enabled ?? base.enabled,
    mode: row?.mode ?? base.mode,
    notebookId: row?.notebookId || base.notebookId,
    maxSources: base.maxSources,
  };
}

/** Upsert the operator's runtime NotebookLM settings (the single "default" row). */
export function saveNotebookLmSettings(
  db: DB,
  input: { enabled: boolean; mode: "discovery" | "existing"; notebookId: string },
  now: string,
): void {
  db.insert(notebooklmSettings)
    .values({ id: "default", ...input, updatedAt: now })
    .onConflictDoUpdate({ target: notebooklmSettings.id, set: { ...input, updatedAt: now } })
    .run();
}

export type NotebookInsightDeps = {
  client: NotebookLmClient;
  now: () => string;
  id: () => string;
  promptOverrides?: Record<string, string>;
};

/**
 * The insight plus the full I/O trace of the NotebookLM round-trip, so the UI can show
 * exactly what was sent and what came back (notebook, mode, the prompt, sources pushed).
 */
export type NotebookInsightTrace = NotebookInsight & {
  mode: "discovery" | "existing";
  /** the exact prompt sent to the notebook. */
  prompt: string;
  /** URLs pushed into the notebook as sources before querying (discovery mode only). */
  addedSources: string[];
};

/** Minimal operator-voice context for the insight prompt's {voiceContext} token. */
function voiceContext(config: DecodeConfig): string {
  const parts: string[] = [];
  if (config.profile.voice?.trim()) parts.push(`Creator voice: ${config.profile.voice.trim()}`);
  const biz = [config.businessName, config.businessDescription].filter((s) => s?.trim()).join(" — ");
  if (biz) parts.push(`Operator: ${biz}`);
  if (config.profile.audience?.trim()) parts.push(`Audience: ${config.profile.audience.trim()}`);
  return parts.length ? `\n${parts.join("\n")}` : "";
}

/** Upsert the distilled insight into the shared `insights` table (one row per topic). */
function persistInsight(db: DB, topic: string, insight: NotebookInsight, now: string): void {
  const id = `insight:notebooklm:${topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  db.insert(insights)
    .values({
      id,
      cluster: "notebooklm",
      trend: topic,
      importance: "medium",
      body: insight.text,
      evidence: insight.citations,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: insights.id,
      set: { trend: topic, body: insight.text, evidence: insight.citations, createdAt: now },
    })
    .run();
}

/**
 * Drive NotebookLM to produce a content-ready insight for `topic`, persist it, and
 * return it. `discovery` mode first pushes `sourceUrls` (the run's discovered links)
 * into the notebook as sources; `existing` mode queries a pre-filled notebook directly.
 *
 * Returns null (no throw) when the layer is disabled, cookies aren't imported, or no
 * notebook is selected — these are "not applicable", not failures. CLI failures throw.
 */
export async function runNotebookInsight(
  db: DB,
  config: DecodeConfig,
  topic: string,
  opts: { sourceUrls?: string[]; settings?: ResolvedNotebookLmSettings },
  deps: NotebookInsightDeps,
): Promise<NotebookInsightTrace | null> {
  const settings = opts.settings ?? resolveNotebookLmSettings(db, config);
  if (!settings.enabled) return null;
  if (!deps.client.configured) return null;
  if (!settings.notebookId) return null;

  let addedSources: string[] = [];
  if (settings.mode === "discovery" && opts.sourceUrls?.length) {
    addedSources = opts.sourceUrls.slice(0, settings.maxSources);
    await deps.client.addSources(settings.notebookId, addedSources);
  }

  const prompt = resolvePrompt(
    "notebooklm.insight",
    { topic, voiceContext: voiceContext(config) },
    deps.promptOverrides,
  );
  const insight = await deps.client.query(settings.notebookId, prompt);
  persistInsight(db, topic, insight, deps.now());
  return { ...insight, mode: settings.mode, prompt, addedSources };
}

/**
 * Standalone insight pass (flavor 1): for each topic, query the configured notebook
 * directly and persist the insight — no discovery/render. Used by the `notebooklm-insight`
 * job and the `npm run notebooklm` CLI. Returns the topics that produced an insight.
 */
export async function runNotebookInsightJob(
  db: DB,
  config: DecodeConfig,
  env: Record<string, string | undefined>,
  topics?: string[],
): Promise<string[]> {
  const overrides = loadPromptOverrides(db);
  const deps = buildNotebookInsightDeps(env, config, overrides);
  const settings = resolveNotebookLmSettings(db, config);
  const list = topics && topics.length ? topics : config.trendImitation.topics;
  const produced: string[] = [];
  for (const topic of list) {
    const insight = await runNotebookInsight(db, config, topic, { settings }, deps);
    if (insight) produced.push(topic);
  }
  return produced;
}

/** Build production insight deps (real CLI client + DB-backed prompt overrides). */
export function buildNotebookInsightDeps(
  env: Record<string, string | undefined>,
  config: DecodeConfig,
  promptOverrides?: Record<string, string>,
): NotebookInsightDeps {
  return {
    client: makeNotebookLmClient(env, config.notebooklm.cliTimeoutMs),
    now: () => new Date().toISOString(),
    id: () => randomUUID(),
    promptOverrides,
  };
}
