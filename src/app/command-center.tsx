"use client";

import { useCallback, useEffect, useState } from "react";

type Action = {
  id: string;
  title: string;
  lane: string;
  priority: number;
  valuePerMonth: number;
  effort: string;
  effortHours: number;
  confidence: string;
  status: string;
  rationale: string;
};

type CommandCenter = {
  focusToday: Action[];
  topActions: Action[];
  spend: {
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
    budgetUsd: number;
    pct: number;
  };
  lastRun: {
    status: string;
    finishedAt: string | null;
    costUsd: number;
    stages: { stage: string; durationMs: number; count: number }[];
  } | null;
  counts: {
    signals: number;
    insights: number;
    decisions: number;
    executions: number;
    contentQueue: number;
  };
};

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

type Run = {
  id: string;
  status: string;
  finishedAt: string | null;
  costUsd: number;
  stages: { stage: string; durationMs: number; count: number }[];
};

export default function CommandCenter() {
  const [cc, setCc] = useState<CommandCenter | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([
      fetch("/api/command-center", { cache: "no-store" }),
      fetch("/api/runs", { cache: "no-store" }),
    ]);
    if (c.ok) setCc(await c.json());
    if (r.ok) setRuns((await r.json()).rows);
  }, []);

  useEffect(() => {
    void load();
    const onRan = () => void load();
    window.addEventListener("decode:ran", onRan);
    return () => window.removeEventListener("decode:ran", onRan);
  }, [load]);

  const spendPct = Math.min(100, cc?.spend.pct ?? 0);

  return (
    <main className="mx-auto max-w-[1600px] px-4 pt-8 pb-2">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          DECODE <span className="text-neutral-500">· Command Center</span>
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          Where to point your attention, time, and tokens — ranked by ROI.
        </p>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* Focus today */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Focus today
          </h2>
          <ol className="space-y-2">
            {cc?.focusToday.map((a, i) => (
              <li
                key={a.id}
                className="rounded-lg bg-neutral-900 px-4 py-3 ring-1 ring-neutral-800"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium">
                    <span className="text-neutral-500">{i + 1}.</span> {a.title}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {a.status === "drafted" && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300 ring-1 ring-amber-500/30">
                        draft ready
                      </span>
                    )}
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300 ring-1 ring-emerald-500/30">
                      P{a.priority}
                    </span>
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-400">
                  <span>{a.lane}</span>
                  <span>· ~{a.effortHours}h ({a.effort})</span>
                  <span>· {money(a.valuePerMonth)}/mo potential</span>
                  <span>· {a.confidence} confidence</span>
                </div>
                {a.rationale && (
                  <p className="mt-2 whitespace-pre-wrap text-xs text-neutral-500">
                    {a.rationale}
                  </p>
                )}
              </li>
            ))}
            {cc && cc.focusToday.length === 0 && (
              <li className="text-sm text-neutral-500">
                No open decisions yet — run the loop below.
              </li>
            )}
          </ol>
        </section>

        {/* Right rail: spend + pipeline health */}
        <section className="space-y-6">
          <div className="rounded-lg bg-neutral-900 px-4 py-3 ring-1 ring-neutral-800">
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span className="font-semibold uppercase tracking-wider">
                Token budget
              </span>
              <span>
                {money(cc?.spend.costUsd ?? 0)} / {money(cc?.spend.budgetUsd ?? 0)}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800">
              <div
                className={`h-full ${spendPct >= 90 ? "bg-red-500" : "bg-indigo-500"}`}
                style={{ width: `${spendPct}%` }}
              />
            </div>
            <div className="mt-1.5 text-[11px] text-neutral-600">
              {(cc?.spend.tokensIn ?? 0).toLocaleString()} in ·{" "}
              {(cc?.spend.tokensOut ?? 0).toLocaleString()} out tokens
            </div>
          </div>

          <div className="rounded-lg bg-neutral-900 px-4 py-3 ring-1 ring-neutral-800">
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Pipeline
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-neutral-400">
              <span>{cc?.counts.signals ?? 0} signals</span>
              <span>{cc?.counts.insights ?? 0} insights</span>
              <span>{cc?.counts.decisions ?? 0} decisions</span>
              <span>{cc?.counts.executions ?? 0} drafts</span>
              <span>{cc?.counts.contentQueue ?? 0} to review</span>
            </div>
            <div className="mt-2 text-[11px] text-neutral-600">
              {cc?.lastRun
                ? `last run: ${cc.lastRun.status} · ${money(cc.lastRun.costUsd)}`
                : "no runs yet"}
            </div>
          </div>

          <div className="rounded-lg bg-neutral-900 px-4 py-3 ring-1 ring-neutral-800">
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Recent runs
            </div>
            <ul className="mt-2 space-y-1 text-[11px] text-neutral-400">
              {runs.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span className={r.status === "ok" ? "text-emerald-400" : "text-red-400"}>
                    {r.status}
                  </span>
                  <span className="text-neutral-500">
                    {r.stages.reduce((a, s) => a + s.durationMs, 0)}ms ·{" "}
                    {money(r.costUsd)}
                  </span>
                </li>
              ))}
              {runs.length === 0 && <li className="text-neutral-600">no runs yet</li>}
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
