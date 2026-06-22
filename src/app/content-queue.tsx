"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Execution } from "@/db/schema";
import { PLATFORMS, type GeneratedPost, type Platform } from "@/publishing/postGenerator";
import { validatePost } from "@/publishing/validate";
import { draftsFromExecution, assetPromptFromExecution } from "@/publishing/executionPost";
import { buildBulkComposeInputs } from "@/publishing/bulkQueue";

const PLATFORM_LABEL: Record<Platform, string> = {
  x: "X",
  reddit: "Reddit",
  instagram: "Instagram",
  facebook: "Facebook",
};

type QueueStatus = "queued" | "draft" | "error";
type DraftsByPlatform = Record<Platform, GeneratedPost & { issues: string[] }>;

function Chip({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ${tone}`}>
      {children}
    </span>
  );
}

const WARNING_TONE = "bg-amber-500/15 text-amber-300 ring-amber-500/30";
const ENGAGEMENT_TONE = "bg-indigo-500/15 text-indigo-300 ring-indigo-500/30";

function baseDrafts(exec: Execution): DraftsByPlatform {
  const variants = draftsFromExecution(exec);
  const out = {} as DraftsByPlatform;
  for (const p of PLATFORMS) {
    out[p] = { ...variants[p], issues: validatePost(p, variants[p], { url: "", hasImage: false }) };
  }
  return out;
}

/** Recompute the Instagram entry's issues once a cover image is (or isn't) available. */
function withAssetAwareIssues(drafts: DraftsByPlatform, hasImage: boolean): DraftsByPlatform {
  return {
    ...drafts,
    instagram: {
      ...drafts.instagram,
      issues: validatePost("instagram", drafts.instagram, { url: "", hasImage }),
    },
  };
}

function ContentQueueItem({
  exec,
  channelsByPlatform,
  higgsfieldConfigured,
  onResolved,
}: {
  exec: Execution;
  channelsByPlatform: Partial<Record<Platform, string>>;
  higgsfieldConfigured: boolean;
  onResolved: (id: string) => void;
}) {
  const drafts0 = useMemo(() => baseDrafts(exec), [exec]);
  const [assetPromptDraft, setAssetPromptDraft] = useState(() => assetPromptFromExecution(exec));
  const [asset, setAsset] = useState<{ url: string; type: "image" } | null>(null);
  const [generatingAsset, setGeneratingAsset] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [queueResults, setQueueResults] = useState<Partial<Record<Platform, QueueStatus>> | null>(
    null,
  );

  const drafts = useMemo(() => withAssetAwareIssues(drafts0, !!asset), [drafts0, asset]);

  const generateAsset = useCallback(async () => {
    if (!assetPromptDraft.trim()) return;
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
      setAsset(body.asset);
    } catch (e) {
      setAssetError(e instanceof Error ? e.message : "failed to generate asset");
    } finally {
      setGeneratingAsset(false);
    }
  }, [assetPromptDraft]);

  const resolve = useCallback(
    async (action: "publish" | "dismiss") => {
      const res = await fetch(`/api/executions/${exec.id}?action=${action}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `failed to ${action}`);
      }
    },
    [exec.id],
  );

  const queueAll = useCallback(async () => {
    setActing(true);
    setActionError(null);
    try {
      const imageUrlByPlatform: Partial<Record<Platform, string>> = asset
        ? Object.fromEntries(PLATFORMS.map((p) => [p, asset.url]))
        : {};
      const inputs = buildBulkComposeInputs(
        drafts,
        channelsByPlatform,
        { topic: exec.lane, itemTitle: exec.title, keyword: exec.lane },
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
      setQueueResults(results);
      await resolve("publish");
      onResolved(exec.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "failed to queue");
    } finally {
      setActing(false);
    }
  }, [asset, drafts, channelsByPlatform, exec.id, exec.lane, exec.title, resolve, onResolved]);

  const dismiss = useCallback(async () => {
    setActing(true);
    setActionError(null);
    try {
      await resolve("dismiss");
      onResolved(exec.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "failed to dismiss");
    } finally {
      setActing(false);
    }
  }, [resolve, onResolved, exec.id]);

  return (
    <li className="rounded-lg bg-neutral-900 px-3 py-2.5 ring-1 ring-neutral-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-sm font-medium text-neutral-100">{exec.title}</span>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <span>{exec.lane}</span>
            <Chip tone={ENGAGEMENT_TONE}>quality {exec.qualityScore.toFixed(1)}/5</Chip>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={dismiss}
            disabled={acting}
            className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
          >
            Dismiss
          </button>
          <button
            onClick={queueAll}
            disabled={acting || Object.keys(channelsByPlatform).length === 0}
            className="rounded-md bg-emerald-500/80 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-400 disabled:opacity-50"
          >
            {acting ? "Queuing…" : "Queue all"}
          </button>
        </div>
      </div>

      <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-xs text-neutral-400">{exec.body}</p>

      {actionError && <p className="mt-1.5 text-xs text-red-300">{actionError}</p>}

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
        {asset && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.url} alt="" className="mt-2 max-h-48 rounded-md ring-1 ring-neutral-800" />
        )}
      </div>

      <div className="mt-2 space-y-2">
        {PLATFORMS.map((p) => (
          <div key={p} className="rounded-md bg-neutral-950 px-2.5 py-2 ring-1 ring-neutral-800">
            <span className="text-xs font-semibold text-neutral-400">{PLATFORM_LABEL[p]}</span>
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

      {queueResults && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-neutral-500">Queued:</span>
          {Object.entries(queueResults).map(([p, status]) => (
            <Chip key={p} tone={status === "error" ? WARNING_TONE : ENGAGEMENT_TONE}>
              {PLATFORM_LABEL[p as Platform]}: {status}
            </Chip>
          ))}
        </div>
      )}
    </li>
  );
}

export default function ContentQueue() {
  const [rows, setRows] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelsByPlatform, setChannelsByPlatform] = useState<Partial<Record<Platform, string>>>(
    {},
  );
  const [higgsfieldConfigured, setHiggsfieldConfigured] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cqRes, cfgRes] = await Promise.all([
        fetch("/api/content-queue", { cache: "no-store" }),
        fetch("/api/publishing/config", { cache: "no-store" }),
      ]);
      const cqBody = await cqRes.json();
      if (!cqRes.ok) throw new Error(cqBody.error ?? "failed to load content queue");
      setRows(cqBody.rows as Execution[]);
      if (cfgRes.ok) {
        const cfgBody = await cfgRes.json();
        setChannelsByPlatform(cfgBody.channelsByPlatform ?? {});
        setHiggsfieldConfigured(Boolean(cfgBody.higgsfieldConfigured));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load content queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onRan = () => void load();
    window.addEventListener("decode:ran", onRan);
    return () => window.removeEventListener("decode:ran", onRan);
  }, [load]);

  const onResolved = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return (
    <section className="w-full">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">
          Content queue <span className="text-neutral-500">· Review</span>
        </h2>
        <p className="mt-1 text-sm text-neutral-400">
          Drafts the EXECUTE stage quality-gated and marked ready. Approve a cover image, review
          per-platform posts, then queue to Buffer or dismiss back to drafts.
        </p>
      </header>

      {error && (
        <div className="mt-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/30">
          {error}
        </div>
      )}

      <ul className="mt-4 space-y-3">
        {rows.map((exec) => (
          <ContentQueueItem
            key={exec.id}
            exec={exec}
            channelsByPlatform={channelsByPlatform}
            higgsfieldConfigured={higgsfieldConfigured}
            onResolved={onResolved}
          />
        ))}
        {!loading && rows.length === 0 && (
          <li className="text-sm text-neutral-500">
            Nothing to review — run the loop above to generate drafts.
          </li>
        )}
      </ul>
    </section>
  );
}
