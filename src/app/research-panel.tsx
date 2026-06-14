"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResearchReport } from "@/research/last30days";

export type DraftSeed = { text: string; imageUrl?: string };

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

function formatEngagement(engagement: Record<string, number>): string[] {
  return Object.entries(engagement)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} ${v}`);
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
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
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
      setReport(body.report as ResearchReport);
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
    async (item: ResearchReport["itemsBySource"][string][number], key: string) => {
      if (!onDraft || !report) return;
      setGeneratingKey(key);
      setGenError(null);
      try {
        const res = await fetch("/api/buffer/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ topic: report.topic, item }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "failed to generate post");
        onDraft({ text: body.draft.text as string });
      } catch (e) {
        setGenError(e instanceof Error ? e.message : "failed to generate post");
      } finally {
        setGeneratingKey(null);
      }
    },
    [onDraft, report],
  );

  const sources = report ? Object.entries(report.itemsBySource) : [];
  const errorSources = report ? Object.entries(report.errorsBySource) : [];

  return (
    <section className="mx-auto mt-12 max-w-6xl px-6">
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
            {errorSources.map(([source, message]) => (
              <Chip key={source} tone={WARNING_TONE}>
                {source}: {message}
              </Chip>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
            {sources.map(([source, items]) => (
              <div key={source}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  {source} <span className="text-neutral-600">({items.length})</span>
                </h3>
                <ul className="space-y-2">
                  {items.map((item, i) => (
                    <li
                      key={`${source}-${i}`}
                      className="rounded-lg bg-neutral-900 px-3 py-2.5 ring-1 ring-neutral-800"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium text-neutral-100 hover:text-indigo-300 hover:underline"
                        >
                          {item.title}
                        </a>
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
                              onClick={() => generate(item, `${source}-${i}`)}
                              disabled={generatingKey !== null}
                              className="rounded-md bg-indigo-500/80 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
                            >
                              {generatingKey === `${source}-${i}`
                                ? "Generating…"
                                : "Generate post"}
                            </button>
                          </div>
                        )}
                      </div>
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
                  ))}
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
