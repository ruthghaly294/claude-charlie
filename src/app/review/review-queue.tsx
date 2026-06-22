"use client";

import { useCallback, useEffect, useState } from "react";

type Item = {
  id: string;
  topic: string;
  status: string;
  format?: string;
  coverImageUrl: string | null;
  videoUrl: string;
  slideUrls?: string[] | null;
  caption: string;
  soundMood: string | null;
  viralityScore: number | null;
  bufferPostId: string | null;
  createdAt: string;
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  scored: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  queued: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  publishing: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  published: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  rejected: "bg-red-500/15 text-red-300 border-red-500/30",
  generated: "bg-neutral-500/15 text-neutral-300 border-neutral-600/40",
  error: "bg-red-500/15 text-red-300 border-red-500/30",
};

type PublishResult = {
  published: boolean;
  pending: boolean;
  bufferStatus?: string;
  error?: string | null;
  sentAt?: string | null;
};

type Action = "queue" | "schedule" | "publish" | "status" | "delete";

function Card({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);

  const request = useCallback(
    async (action: Action, dueAt?: string) => {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, action, dueAt }),
      });
      const json = (await res.json()) as PublishResult & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      return json;
    },
    [item.id],
  );

  async function act(action: Action) {
    setBusy(action);
    setErr(null);
    try {
      const json = await request(
        action,
        action === "schedule" && when ? new Date(when).toISOString() : undefined,
      );
      if (action === "publish" || action === "status") {
        setResult({
          published: !!json.published,
          pending: !!json.pending,
          bufferStatus: json.bufferStatus,
          error: json.error,
          sentAt: json.sentAt,
        });
      }
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const done = item.status === "published" || item.status === "rejected";
  const canApprove = Boolean(item.bufferPostId);
  const isError = item.status === "error" || Boolean(result?.error);
  const isPending = (result?.pending || item.status === "publishing") && !result?.published && !result?.error;

  // While a post is mid-publish (Instagram processing), silently poll Buffer's
  // status until it's confirmed published or errored — no manual "Check status".
  useEffect(() => {
    if (!isPending || busy) return;
    let active = true;
    const tick = async () => {
      try {
        const json = await request("status");
        if (!active) return;
        setResult({
          published: !!json.published,
          pending: !!json.pending,
          bufferStatus: json.bufferStatus,
          error: json.error,
          sentAt: json.sentAt,
        });
        if (json.published || json.error) onChanged();
      } catch {
        /* keep polling */
      }
    };
    const t = setInterval(() => void tick(), 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [isPending, busy, request, onChanged]);

  return (
    <div className="flex gap-4 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="w-[180px] shrink-0 space-y-2">
        {item.format === "qotd-carousel" && item.slideUrls?.length ? (
          <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-md">
            {item.slideUrls.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt={`slide ${i + 1}`}
                className="aspect-[4/5] w-full shrink-0 snap-center rounded-md border border-neutral-800 bg-black object-cover"
              />
            ))}
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={item.videoUrl}
              poster={item.coverImageUrl ?? undefined}
              controls
              className="aspect-[9/16] w-full rounded-md bg-black object-cover"
            />
            {item.coverImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.coverImageUrl}
                alt="cover"
                className="aspect-[9/16] w-full rounded-md border border-neutral-800 bg-black object-cover"
              />
            )}
          </>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="font-medium text-neutral-100">{item.topic}</span>
          <span className={`rounded border px-1.5 py-0.5 text-xs ${STATUS_TONE[item.status] ?? STATUS_TONE.generated}`}>
            {item.status}
          </span>
          {item.viralityScore != null && (
            <span className="text-xs text-neutral-500">virality {item.viralityScore}</span>
          )}
          {item.soundMood && <span className="text-xs text-neutral-500">· {item.soundMood}</span>}
        </div>
        <p className="whitespace-pre-wrap text-sm text-neutral-300">{item.caption}</p>

        {err && <p className="mt-2 text-xs text-red-400">{err}</p>}

        {result && (
          <div
            className={`mt-3 rounded-md border px-3 py-2 text-sm ${
              result.published
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : result.error
                  ? "border-red-500/40 bg-red-500/10 text-red-300"
                  : "border-sky-500/40 bg-sky-500/10 text-sky-300"
            }`}
          >
            {result.published ? (
              <span>✓ Published to Instagram{result.sentAt ? ` · ${new Date(result.sentAt).toLocaleString()}` : ""}</span>
            ) : result.error ? (
              <span>✗ Not published — {result.error}</span>
            ) : (
              <span>
                Publishing… Buffer status: {result.bufferStatus ?? "sending"}. Instagram is processing — click
                “Check status”.
              </span>
            )}
          </div>
        )}

        {!done && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canApprove && (
              <>
                <button
                  onClick={() => act("publish")}
                  disabled={!!busy || isPending}
                  className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"
                >
                  {busy === "publish" ? "Publishing…" : isError ? "↻ Retry publish" : "🚀 Publish now"}
                </button>
                {isPending && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-sky-300">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-400" />
                    {busy === "status" ? "Checking…" : "Publishing… auto-checking"}
                  </span>
                )}
                <button
                  onClick={() => act("queue")}
                  disabled={!!busy}
                  className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 disabled:opacity-50"
                >
                  {busy === "queue" ? "Queuing…" : "Add to queue"}
                </button>
                <input
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm"
                />
                <button
                  onClick={() => act("schedule")}
                  disabled={!!busy || !when}
                  className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 disabled:opacity-50"
                >
                  {busy === "schedule" ? "Scheduling…" : "Schedule"}
                </button>
              </>
            )}
            {!canApprove && (
              <span className="text-xs text-neutral-500">Generated but not pushed to Buffer (no channel at run time).</span>
            )}
            <button
              onClick={() => act("delete")}
              disabled={!!busy}
              className="rounded-md border border-red-500/40 px-3 py-1.5 text-sm text-red-300 disabled:opacity-50"
            >
              {busy === "delete" ? "Removing…" : "Reject"}
            </button>
          </div>
        )}
        {done && <p className="mt-3 text-xs text-neutral-500">No further actions — {item.status}.</p>}
      </div>
    </div>
  );
}

const FILTERS = ["all", "draft", "publishing", "published", "queued", "error"] as const;
type Filter = (typeof FILTERS)[number];

export default function ReviewQueue() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch("/api/review");
      const json = (await res.json()) as { items?: Item[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setItems(json.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = items.reduce<Record<string, number>>((acc, it) => {
    acc[it.status] = (acc[it.status] ?? 0) + 1;
    return acc;
  }, {});
  const shown = filter === "all" ? items : items.filter((it) => it.status === filter);

  return (
    <div className="mx-auto max-w-[900px] px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Review Queue</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Preview generated reels, then approve to the Buffer queue, schedule a time, or reject.
          </p>
        </div>
        <button onClick={() => void load()} className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300">
          Refresh
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const n = f === "all" ? items.length : counts[f] ?? 0;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                filter === f
                  ? "border-neutral-500 bg-neutral-800 text-neutral-100"
                  : "border-neutral-800 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {f} {n > 0 && <span className="text-neutral-500">({n})</span>}
            </button>
          );
        })}
      </div>

      {err && <div className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</div>}
      {loading && <p className="mt-8 text-sm text-neutral-500">Loading…</p>}
      {!loading && shown.length === 0 && (
        <p className="mt-10 text-center text-sm text-neutral-600">
          {items.length === 0
            ? "Nothing to review yet. Run a Live pipeline on the Trends page to generate a reel."
            : `No ${filter} items.`}
        </p>
      )}

      <div className="mt-6 space-y-3">
        {shown.map((it) => (
          <Card key={it.id} item={it} onChanged={load} />
        ))}
      </div>
    </div>
  );
}
