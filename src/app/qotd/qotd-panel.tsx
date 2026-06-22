"use client";

import { useCallback, useEffect, useState } from "react";

type Meta = { pillars: string[]; available: Record<string, number>; total: number };
type RunResult = {
  ok: true;
  preview: boolean;
  subtopic: string;
  caption: string;
  slideUrls: string[];
  status: string;
  bufferPostId: string | null;
  videoId: string;
};

export default function QotdPanel() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [subtopic, setSubtopic] = useState("");
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState<null | "preview" | "draft">(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  const loadMeta = useCallback(async () => {
    try {
      const res = await fetch("/api/qotd");
      const json = (await res.json()) as Meta & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setMeta(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const run = useCallback(
    async (preview: boolean) => {
      setBusy(preview ? "preview" : "draft");
      setErr(null);
      setResult(null);
      try {
        const res = await fetch("/api/qotd", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ subtopic: subtopic || undefined, count, preview }),
        });
        const json = (await res.json()) as RunResult & { error?: string };
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        setResult(json);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [subtopic, count],
  );

  const totalForSubtopic = subtopic ? (meta?.available[subtopic] ?? 0) : (meta?.total ?? 0);

  return (
    <div className="mx-auto max-w-[900px] px-4 py-8">
      <h1 className="text-xl font-semibold tracking-tight">Question-of-the-Day carousel</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Group 5 verified FRCR statements into an @frcrbank carousel. <strong>Preview</strong> renders the
        slides without posting; <strong>Create draft</strong> sends a Buffer draft you approve on{" "}
        <a href="/review" className="text-sky-300 underline">
          /review
        </a>
        . Nothing auto-publishes.
      </p>

      <div className="mt-5 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-400">Subtopic</span>
          <select
            value={subtopic}
            onChange={(e) => setSubtopic(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
          >
            <option value="">Auto (rotation)</option>
            {meta?.pillars.map((p) => (
              <option key={p} value={p}>
                {p} ({meta.available[p] ?? 0})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-400">Statements</span>
          <input
            type="number"
            min={1}
            max={8}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(8, Number(e.target.value) || 5)))}
            className="w-20 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
          />
        </label>

        <button
          onClick={() => void run(true)}
          disabled={busy !== null}
          className="rounded-md border border-neutral-700 px-4 py-1.5 text-sm text-neutral-200 disabled:opacity-50"
        >
          {busy === "preview" ? "Rendering…" : "Preview"}
        </button>
        <button
          onClick={() => void run(false)}
          disabled={busy !== null}
          className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === "draft" ? "Creating…" : "Create draft"}
        </button>

        <span className="ml-auto text-xs text-neutral-500">
          {totalForSubtopic} verified statement{totalForSubtopic === 1 ? "" : "s"} available
        </span>
      </div>

      {err && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300">{result.subtopic}</span>
            {result.preview ? (
              <span className="text-amber-300">Preview — not posted</span>
            ) : (
              <span className="text-emerald-300">
                Draft created{result.bufferPostId ? ` (Buffer ${result.bufferPostId})` : ""} —{" "}
                <a href="/review" className="underline">
                  review it →
                </a>
              </span>
            )}
          </div>

          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
            {result.slideUrls.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt={`slide ${i + 1}`}
                className="aspect-[4/5] w-[220px] shrink-0 snap-center rounded-md border border-neutral-800 bg-black object-cover"
              />
            ))}
          </div>

          <div className="rounded-md border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Caption</div>
            <p className="whitespace-pre-wrap text-sm text-neutral-300">{result.caption}</p>
          </div>
        </div>
      )}
    </div>
  );
}
