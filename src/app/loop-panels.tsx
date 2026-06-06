"use client";

import { useCallback, useEffect, useState } from "react";

type Insight = {
  id: string;
  cluster: string;
  trend: string;
  importance: string;
  body: string;
};
type Decision = {
  id: string;
  lane: string;
  title: string;
  impact: string;
  effort: string;
  priority: number;
  status: string;
};
type Execution = {
  id: string;
  lane: string;
  title: string;
  body: string;
  status: string;
};

type Digest = {
  signals: { kept: number; archived: number };
  insights: { count: number };
  decisions: { count: number };
  executions: { count: number };
};

function importanceTone(v: string): string {
  if (v === "high") return "bg-rose-500/15 text-rose-300 ring-rose-500/30";
  if (v === "medium") return "bg-amber-500/15 text-amber-300 ring-amber-500/30";
  return "bg-neutral-500/15 text-neutral-400 ring-neutral-500/30";
}

function Chip({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ${tone}`}
    >
      {children}
    </span>
  );
}

export default function LoopPanels() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [running, setRunning] = useState(false);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [i, d, e] = await Promise.all([
      fetch("/api/insights", { cache: "no-store" }),
      fetch("/api/decisions", { cache: "no-store" }),
      fetch("/api/executions", { cache: "no-store" }),
    ]);
    if (i.ok) setInsights((await i.json()).rows);
    if (d.ok) setDecisions((await d.json()).rows);
    if (e.ok) setExecutions((await e.json()).rows);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const runLoop = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/decode", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "decode failed");
      setDigest(body as Digest);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "decode failed");
    } finally {
      setRunning(false);
    }
  }, [loadAll]);

  return (
    <section className="mx-auto mt-12 max-w-6xl px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            DECODE <span className="text-neutral-500">· Observe → Decide → Execute</span>
          </h2>
          <p className="mt-1 text-sm text-neutral-400">
            Distill kept signals into insights, decisions, and drafted assets.
          </p>
        </div>
        <button
          onClick={runLoop}
          disabled={running}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow hover:bg-emerald-400 disabled:opacity-50"
        >
          {running ? "Running loop…" : "Run loop"}
        </button>
      </header>

      {error && (
        <div className="mt-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/30">
          {error}
        </div>
      )}

      {digest && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Signals kept", digest.signals.kept],
            ["Insights", digest.insights.count],
            ["Decisions", digest.decisions.count],
            ["Executions", digest.executions.count],
          ].map(([label, n]) => (
            <div
              key={label}
              className="rounded-lg bg-neutral-900 px-4 py-3 ring-1 ring-neutral-800"
            >
              <div className="text-2xl font-semibold tabular-nums">{n}</div>
              <div className="text-xs text-neutral-500">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Insights */}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Insights <span className="text-neutral-600">({insights.length})</span>
          </h3>
          <ul className="space-y-2">
            {insights.map((i) => (
              <li
                key={i.id}
                className="rounded-lg bg-neutral-900 px-3 py-2.5 ring-1 ring-neutral-800"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{i.trend}</span>
                  <Chip tone={importanceTone(i.importance)}>{i.importance}</Chip>
                </div>
                <div className="mt-1 text-xs text-neutral-500">{i.cluster}</div>
              </li>
            ))}
            {insights.length === 0 && (
              <li className="text-sm text-neutral-500">
                No insights yet — run the loop.
              </li>
            )}
          </ul>
        </div>

        {/* Decisions */}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Decisions{" "}
            <span className="text-neutral-600">({decisions.length})</span>
          </h3>
          <ul className="space-y-2">
            {decisions.map((d) => (
              <li
                key={d.id}
                className="rounded-lg bg-neutral-900 px-3 py-2.5 ring-1 ring-neutral-800"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{d.title}</span>
                  <span className="tabular-nums text-xs text-neutral-400">
                    P{d.priority}
                  </span>
                </div>
                <div className="mt-1 flex gap-2 text-xs text-neutral-500">
                  <span>{d.lane}</span>
                  <span>· impact {d.impact}</span>
                  <span>· effort {d.effort}</span>
                  {d.status === "done" && <span>· ✓ drafted</span>}
                </div>
              </li>
            ))}
            {decisions.length === 0 && (
              <li className="text-sm text-neutral-500">No decisions yet.</li>
            )}
          </ul>
        </div>

        {/* Executions */}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Execution{" "}
            <span className="text-neutral-600">({executions.length})</span>
          </h3>
          <ul className="space-y-2">
            {executions.map((e) => (
              <li
                key={e.id}
                className="rounded-lg bg-neutral-900 px-3 py-2.5 ring-1 ring-neutral-800"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{e.title}</span>
                  <Chip tone="bg-indigo-500/15 text-indigo-300 ring-indigo-500/30">
                    {e.status}
                  </Chip>
                </div>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-neutral-400">
                  {e.body}
                </pre>
              </li>
            ))}
            {executions.length === 0 && (
              <li className="text-sm text-neutral-500">No drafts yet.</li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}
