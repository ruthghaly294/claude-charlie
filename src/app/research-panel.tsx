"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RankedItem, RankedReport } from "@/research/rank";
import { buildBulkComposeInputs } from "@/publishing/bulkQueue";
import { MAX_AMALGAMATION_ITEMS } from "@/publishing/postGenerator";
import { validatePost } from "@/publishing/validate";

export type DraftSeed = { text: string; imageUrl?: string; issues?: string[] };

const PLATFORMS = ["x", "reddit", "instagram", "facebook"] as const;
type Platform = (typeof PLATFORMS)[number];
const PLATFORM_LABEL: Record<Platform, string> = {
  x: "X",
  reddit: "Reddit",
  instagram: "Instagram",
  facebook: "Facebook",
};

type AnnotatedItem = RankedItem & { alreadyPosted: boolean };
type AnnotatedReport = Omit<RankedReport, "itemsBySource" | "topPicks"> & {
  itemsBySource: Record<string, AnnotatedItem[]>;
};
type QueueStatus = "queued" | "draft" | "error";
type DraftsByPlatform = Record<Platform, { text: string; hashtags: string[]; issues: string[] }>;

function Chip({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ${tone}`}
    >
      {children}
    </span>
  );
}

const ENGAGEMENT_TONE = "bg-indigo-500/15 text-indigo-300 ring-indigo-500/30";
const WARNING_TONE = "bg-amber-500/15 text-amber-300 ring-amber-500/30";
const OK_TONE = "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30";
const IDLE_TONE = "bg-neutral-700/20 text-neutral-500 ring-neutral-700/40";

// Every source the last30days pipeline attempts, so the health strip shows a
// source that returned nothing (0) or errored, not just the ones that had hits.
const KNOWN_SOURCES = [
  "reddit",
  "x",
  "youtube",
  "tiktok",
  "instagram",
  "threads",
  "hackernews",
  "github",
  "grounding",
  "polymarket",
];

function formatEngagement(engagement: Record<string, number>): string[] {
  return Object.entries(engagement)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} ${v}`);
}

/** Recompute the Instagram entry's issues once a cover image is (or isn't) available. */
function withAssetAwareIssues(
  drafts: DraftsByPlatform,
  url: string,
  hasImage: boolean,
): DraftsByPlatform {
  return {
    ...drafts,
    instagram: {
      ...drafts.instagram,
      issues: validatePost("instagram", drafts.instagram, { url, hasImage }),
    },
  };
}

/** Inline previews of generated per-platform drafts, with optional "Load X" buttons. */
function DraftPreview({
  drafts,
  onLoad,
}: {
  drafts: DraftsByPlatform;
  onLoad?: (platform: Platform) => void;
}) {
  return (
    <div className="mt-2 space-y-2">
      {PLATFORMS.map((p) => (
        <div key={p} className="rounded-md bg-neutral-950 px-2.5 py-2 ring-1 ring-neutral-800">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-neutral-400">{PLATFORM_LABEL[p]}</span>
            {onLoad && (
              <button
                onClick={() => onLoad(p)}
                className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
              >
                Load {PLATFORM_LABEL[p]}
              </button>
            )}
          </div>
          <pre className="mt-1 whitespace-pre-wrap text-xs text-neutral-300">{drafts[p].text}</pre>
          {drafts[p].issues.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {drafts[p].issues.map((issue, i) => (
                <Chip key={i} tone={WARNING_TONE}>
                  {issue}
                </Chip>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ResearchPanel({
  onDraft,
}: {
  onDraft?: (seed: DraftSeed) => void;
}) {
  const [topic, setTopic] = useState("");
  const [quick, setQuick] = useState(false);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [report, setReport] = useState<AnnotatedReport | null>(null);
  const [topPicks, setTopPicks] = useState<AnnotatedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [draftsByKey, setDraftsByKey] = useState<Record<string, DraftsByPlatform>>({});
  const [channelsByPlatform, setChannelsByPlatform] = useState<Partial<Record<Platform, string>>>(
    {},
  );
  const [queueingKey, setQueueingKey] = useState<string | null>(null);
  const [queueResultsByKey, setQueueResultsByKey] = useState<
    Record<string, Partial<Record<Platform, QueueStatus>>>
  >({});
  const [selected, setSelected] = useState<Map<string, AnnotatedItem>>(new Map());
  const [amalgamation, setAmalgamation] = useState<{
    items: AnnotatedItem[];
    drafts: DraftsByPlatform;
    assetPrompt: string;
    asset: { url: string; type: "image" } | null;
  } | null>(null);
  const [generatingAmalgam, setGeneratingAmalgam] = useState(false);
  const [amalgamError, setAmalgamError] = useState<string | null>(null);
  const [amalgamQueueing, setAmalgamQueueing] = useState(false);
  const [amalgamQueueResults, setAmalgamQueueResults] = useState<
    Partial<Record<Platform, QueueStatus>> | null
  >(null);
  const [assetPromptDraft, setAssetPromptDraft] = useState("");
  const [generatingAsset, setGeneratingAsset] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [higgsfieldConfigured, setHiggsfieldConfigured] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    fetch("/api/publishing/config", { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        setChannelsByPlatform(body.channelsByPlatform ?? {});
        setHiggsfieldConfigured(Boolean(body.higgsfieldConfigured));
      })
      .catch(() => {});
  }, []);

  const runResearch = useCallback(async () => {
    if (topic.trim().length < 2) {
      setError("Enter a topic (at least 2 characters).");
      return;
    }
    setRunning(true);
    setError(null);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), quick }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "research failed");
      setReport(body.report as AnnotatedReport);
      setTopPicks((body.topPicks ?? []) as AnnotatedItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "research failed");
    } finally {
      setRunning(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [topic, quick]);

  const generate = useCallback(
    async (item: AnnotatedItem, key: string) => {
      if (!onDraft || !report) return;
      setGeneratingKey(key);
      setGenError(null);
      try {
        const res = await fetch("/api/buffer/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ topic: report.topic, items: [item] }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "failed to generate posts");
        setDraftsByKey((prev) => ({
          ...prev,
          [key]: body.drafts as DraftsByPlatform,
        }));
      } catch (e) {
        setGenError(e instanceof Error ? e.message : "failed to generate posts");
      } finally {
        setGeneratingKey(null);
      }
    },
    [onDraft, report],
  );

  const toggleSelected = useCallback((item: AnnotatedItem) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.url)) {
        next.delete(item.url);
      } else if (next.size < MAX_AMALGAMATION_ITEMS) {
        next.set(item.url, item);
      }
      return next;
    });
  }, []);

  const queueAll = useCallback(
    async (item: AnnotatedItem, key: string) => {
      const drafts = draftsByKey[key];
      if (!report || !drafts) return;
      setQueueingKey(key);
      setGenError(null);
      try {
        const inputs = buildBulkComposeInputs(drafts, channelsByPlatform, {
          topic: report.topic,
          itemUrl: item.url,
          itemTitle: item.title,
          keyword: report.topic,
        });
        const results: Partial<Record<Platform, QueueStatus>> = {};
        for (const input of inputs) {
          try {
            const res = await fetch("/api/buffer/posts", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(input),
            });
            if (!res.ok) {
              results[input.platform] = "error";
              continue;
            }
            const resBody = await res.json();
            results[input.platform] = resBody.post?.status === "draft" ? "draft" : "queued";
          } catch {
            results[input.platform] = "error";
          }
        }
        setQueueResultsByKey((prev) => ({ ...prev, [key]: results }));
      } finally {
        setQueueingKey(null);
      }
    },
    [report, draftsByKey, channelsByPlatform],
  );

  const generateAmalgamation = useCallback(async () => {
    if (!report || selected.size < 2) return;
    const items = [...selected.values()].sort((a, b) => b.score - a.score);
    setGeneratingAmalgam(true);
    setAmalgamError(null);
    setAmalgamQueueResults(null);
    setAssetError(null);
    try {
      const res = await fetch("/api/buffer/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: report.topic, items }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "failed to generate posts");
      const assetPrompt = body.assetPrompt as string;
      setAmalgamation({ items, drafts: body.drafts as DraftsByPlatform, assetPrompt, asset: null });
      setAssetPromptDraft(assetPrompt);
      setSelected(new Map());
    } catch (e) {
      setAmalgamError(e instanceof Error ? e.message : "failed to generate posts");
    } finally {
      setGeneratingAmalgam(false);
    }
  }, [report, selected]);

  const generateAsset = useCallback(async () => {
    if (!amalgamation || !assetPromptDraft.trim()) return;
    setGeneratingAsset(true);
    setAssetError(null);
    try {
      const res = await fetch("/api/higgsfield/generate-asset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: assetPromptDraft }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "failed to generate asset");
      setAmalgamation((prev) => (prev ? { ...prev, asset: body.asset } : prev));
    } catch (e) {
      setAssetError(e instanceof Error ? e.message : "failed to generate asset");
    } finally {
      setGeneratingAsset(false);
    }
  }, [amalgamation, assetPromptDraft]);

  const queueAllAmalgamation = useCallback(async () => {
    if (!report || !amalgamation) return;
    setAmalgamQueueing(true);
    setAmalgamError(null);
    try {
      const drafts = withAssetAwareIssues(
        amalgamation.drafts,
        amalgamation.items[0]!.url,
        !!amalgamation.asset,
      );
      const imageUrlByPlatform: Partial<Record<Platform, string>> = amalgamation.asset
        ? Object.fromEntries(PLATFORMS.map((p) => [p, amalgamation.asset!.url]))
        : {};
      const inputs = buildBulkComposeInputs(
        drafts,
        channelsByPlatform,
        {
          topic: report.topic,
          itemUrl: amalgamation.items[0]!.url,
          itemTitle: amalgamation.items[0]!.title,
          keyword: report.topic,
        },
        imageUrlByPlatform,
      );
      const results: Partial<Record<Platform, QueueStatus>> = {};
      for (const input of inputs) {
        try {
          const res = await fetch("/api/buffer/posts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
          });
          if (!res.ok) {
            results[input.platform] = "error";
            continue;
          }
          const resBody = await res.json();
          results[input.platform] = resBody.post?.status === "draft" ? "draft" : "queued";
        } catch {
          results[input.platform] = "error";
        }
      }
      setAmalgamQueueResults(results);
    } finally {
      setAmalgamQueueing(false);
    }
  }, [report, amalgamation, channelsByPlatform]);

  const amalgamDrafts = amalgamation
    ? withAssetAwareIssues(amalgamation.drafts, amalgamation.items[0]!.url, !!amalgamation.asset)
    : null;

  const sources = report ? Object.entries(report.itemsBySource) : [];
  const sourceHealth = report
    ? Array.from(
        new Set([
          ...KNOWN_SOURCES,
          ...Object.keys(report.itemsBySource),
          ...Object.keys(report.errorsBySource),
        ]),
      )
        .map((name) => ({
          name,
          count: report.itemsBySource[name]?.length ?? 0,
          error: report.errorsBySource[name],
        }))
        .sort((a, b) => b.count - a.count)
    : [];
  const liveSourceCount = sourceHealth.filter((s) => s.count > 0).length;

  return (
    <section className="w-full">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            last30days <span className="text-neutral-500">· Research</span>
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            What people are saying about a topic across Reddit, X, YouTube, TikTok,
            Instagram, Hacker News, and GitHub — last 30 days.
          </p>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runResearch();
          }}
          placeholder="topic or idea — e.g. AI coding agents"
          className="min-w-64 flex-1 rounded-md bg-neutral-900 px-3 py-2 text-sm ring-1 ring-neutral-800 placeholder:text-neutral-600"
        />
        <label className="flex items-center gap-2 text-sm text-neutral-400">
          <input
            type="checkbox"
            checked={quick}
            onChange={(e) => setQuick(e.target.checked)}
            className="rounded"
          />
          quick
        </label>
        <button
          onClick={runResearch}
          disabled={running}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-400 disabled:opacity-50"
        >
          {running ? `Researching… ${elapsed}s` : "Research"}
        </button>
      </div>

      {running && (
        <p className="mt-2 text-xs text-neutral-500">
          Typically 1–2 minutes — pulls fresh results from Reddit, X, YouTube, TikTok,
          Instagram, Hacker News, and GitHub.
        </p>
      )}

      {error && (
        <div className="mt-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/30">
          {error}
        </div>
      )}

      {genError && (
        <div className="mt-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/30">
          {genError}
        </div>
      )}

      {report && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-400">
            <span>
              {report.rangeFrom} → {report.rangeTo}
            </span>
            {report.warnings.map((w, i) => (
              <Chip key={i} tone={WARNING_TONE}>
                {w}
              </Chip>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-500">
              Sources ({liveSourceCount}/{sourceHealth.length} live):
            </span>
            {sourceHealth.map(({ name, count, error }) => (
              <Chip
                key={name}
                tone={error ? WARNING_TONE : count > 0 ? OK_TONE : IDLE_TONE}
              >
                {name} {error ? `· ${error}` : count}
              </Chip>
            ))}
          </div>

          {selected.size > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-neutral-900 px-3 py-2.5 ring-1 ring-neutral-800">
              <span className="text-sm text-neutral-400">
                {selected.size}/{MAX_AMALGAMATION_ITEMS} selected
              </span>
              <button
                onClick={() => setSelected(new Map())}
                className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
              >
                Clear
              </button>
              <button
                onClick={generateAmalgamation}
                disabled={selected.size < 2 || generatingAmalgam}
                className="rounded-md bg-indigo-500/80 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
              >
                {generatingAmalgam ? "Generating…" : "Generate amalgamation"}
              </button>
              {selected.size < 2 && (
                <span className="text-xs text-neutral-500">Select at least 2 items</span>
              )}
            </div>
          )}

          {amalgamError && (
            <div className="mt-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/30">
              {amalgamError}
            </div>
          )}

          {amalgamation && amalgamDrafts && (
            <div className="mt-4 rounded-lg bg-neutral-900 px-3 py-2.5 ring-1 ring-neutral-800">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Amalgamation <span className="text-neutral-600">({amalgamation.items.length} sources)</span>
              </h3>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {amalgamation.items.map((item) => (
                  <li key={item.url}>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      <Chip tone={ENGAGEMENT_TONE}>{item.title}</Chip>
                    </a>
                  </li>
                ))}
              </ul>
              <DraftPreview
                drafts={amalgamDrafts}
                onLoad={
                  onDraft
                    ? (p) =>
                        onDraft({
                          text: amalgamDrafts[p].text,
                          issues: amalgamDrafts[p].issues,
                        })
                    : undefined
                }
              />
              <div className="mt-3 rounded-md bg-neutral-950 px-2.5 py-2 ring-1 ring-neutral-800">
                <h4 className="text-xs font-semibold text-neutral-400">Digital asset plan</h4>
                <textarea
                  value={assetPromptDraft}
                  onChange={(e) => setAssetPromptDraft(e.target.value)}
                  rows={3}
                  className="mt-1.5 w-full resize-y rounded-md bg-neutral-900 px-2 py-1.5 text-xs text-neutral-300 ring-1 ring-neutral-800 placeholder:text-neutral-600"
                />
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <button
                    onClick={generateAsset}
                    disabled={!higgsfieldConfigured || generatingAsset || !assetPromptDraft.trim()}
                    className="rounded-md bg-indigo-500/80 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
                  >
                    {generatingAsset ? "Generating…" : "Approve & generate asset"}
                  </button>
                  {!higgsfieldConfigured && (
                    <span className="text-xs text-neutral-500">
                      Run `higgsfield auth login` or set HIGGSFIELD_API_KEY to enable
                    </span>
                  )}
                </div>
                {assetError && <p className="mt-1.5 text-xs text-red-300">{assetError}</p>}
                {amalgamation.asset && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={amalgamation.asset.url}
                    alt=""
                    className="mt-2 max-h-48 rounded-md ring-1 ring-neutral-800"
                  />
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button
                  onClick={queueAllAmalgamation}
                  disabled={amalgamQueueing || Object.keys(channelsByPlatform).length === 0}
                  className="rounded-md bg-emerald-500/80 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-400 disabled:opacity-50"
                >
                  {amalgamQueueing ? "Queuing…" : "Queue all"}
                </button>
                {amalgamQueueResults && (
                  <>
                    <span className="text-xs text-neutral-500">Queued:</span>
                    {Object.entries(amalgamQueueResults).map(([p, status]) => (
                      <Chip key={p} tone={status === "error" ? WARNING_TONE : ENGAGEMENT_TONE}>
                        {PLATFORM_LABEL[p as Platform]}: {status}
                      </Chip>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {topPicks.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Top picks <span className="text-neutral-600">({topPicks.length})</span>
              </h3>
              <ul className="space-y-2">
                {topPicks.map((item, i) => (
                  <li
                    key={`pick-${i}`}
                    className="rounded-lg bg-neutral-900 px-3 py-2.5 ring-1 ring-neutral-800"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={selected.has(item.url)}
                          onChange={() => toggleSelected(item)}
                          disabled={!selected.has(item.url) && selected.size >= MAX_AMALGAMATION_ITEMS}
                          className="mt-1 rounded"
                          title="Select for amalgamation"
                        />
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium text-neutral-100 hover:text-indigo-300 hover:underline"
                        >
                          {item.title}
                        </a>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Chip tone={ENGAGEMENT_TONE}>score {item.score.toFixed(2)}</Chip>
                        {item.alreadyPosted && <Chip tone={WARNING_TONE}>Already posted</Chip>}
                      </div>
                    </div>
                    {item.snippet && (
                      <p className="mt-1 line-clamp-2 text-xs text-neutral-400">{item.snippet}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                      <span>{item.source}</span>
                      {item.author && <span>{item.author}</span>}
                      {item.publishedAt && <span>{item.publishedAt}</span>}
                      {formatEngagement(item.engagement).map((e) => (
                        <Chip key={e} tone={ENGAGEMENT_TONE}>
                          {e}
                        </Chip>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
            {sources.map(([source, items]) => (
              <div key={source}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  {source} <span className="text-neutral-600">({items.length})</span>
                </h3>
                <ul className="space-y-2">
                  {items.map((item, i) => {
                    const key = `${source}-${i}`;
                    const drafts = draftsByKey[key];
                    return (
                    <li
                      key={key}
                      className="rounded-lg bg-neutral-900 px-3 py-2.5 ring-1 ring-neutral-800"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={selected.has(item.url)}
                            onChange={() => toggleSelected(item)}
                            disabled={
                              !selected.has(item.url) && selected.size >= MAX_AMALGAMATION_ITEMS
                            }
                            className="mt-1 rounded"
                            title="Select for amalgamation"
                          />
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm font-medium text-neutral-100 hover:text-indigo-300 hover:underline"
                          >
                            {item.title}
                          </a>
                        </div>
                        {onDraft && (
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              onClick={() =>
                                onDraft({
                                  text: `${item.title}\n\n${item.url}`,
                                })
                              }
                              className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
                            >
                              Draft post
                            </button>
                            <button
                              onClick={() => generate(item, key)}
                              disabled={generatingKey !== null}
                              className="rounded-md bg-indigo-500/80 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
                            >
                              {generatingKey === key
                                ? "Generating…"
                                : "Generate posts"}
                            </button>
                            {drafts && (
                              <button
                                onClick={() => queueAll(item, key)}
                                disabled={
                                  queueingKey !== null ||
                                  Object.keys(channelsByPlatform).length === 0
                                }
                                className="rounded-md bg-emerald-500/80 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-400 disabled:opacity-50"
                              >
                                {queueingKey === key ? "Queuing…" : "Queue all"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {onDraft && drafts && (
                        <DraftPreview
                          drafts={drafts}
                          onLoad={(p) => onDraft({ text: drafts[p].text, issues: drafts[p].issues })}
                        />
                      )}
                      {queueResultsByKey[key] && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-neutral-500">Queued:</span>
                          {Object.entries(queueResultsByKey[key]!).map(([p, status]) => (
                            <Chip
                              key={p}
                              tone={status === "error" ? WARNING_TONE : ENGAGEMENT_TONE}
                            >
                              {PLATFORM_LABEL[p as Platform]}: {status}
                            </Chip>
                          ))}
                        </div>
                      )}
                      {item.snippet && (
                        <p className="mt-1 line-clamp-2 text-xs text-neutral-400">
                          {item.snippet}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                        {item.author && <span>{item.author}</span>}
                        {item.publishedAt && <span>{item.publishedAt}</span>}
                        {formatEngagement(item.engagement).map((e) => (
                          <Chip key={e} tone={ENGAGEMENT_TONE}>
                            {e}
                          </Chip>
                        ))}
                      </div>
                    </li>
                    );
                  })}
                  {items.length === 0 && (
                    <li className="text-sm text-neutral-500">No results.</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
