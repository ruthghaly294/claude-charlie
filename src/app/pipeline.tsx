"use client";

import { useCallback, useEffect, useState } from "react";

type Counts = {
  signals: number;
  insights: number;
  decisions: number;
  executions: number;
  contentQueue: number;
};

const ACCENTS = {
  indigo: {
    dot: "bg-indigo-500 shadow-indigo-500/50",
    hoverRing: "hover:ring-indigo-500/40",
    text: "text-indigo-300",
  },
  sky: {
    dot: "bg-sky-500 shadow-sky-500/50",
    hoverRing: "hover:ring-sky-500/40",
    text: "text-sky-300",
  },
  amber: {
    dot: "bg-amber-500 shadow-amber-500/50",
    hoverRing: "hover:ring-amber-500/40",
    text: "text-amber-300",
  },
  emerald: {
    dot: "bg-emerald-500 shadow-emerald-500/50",
    hoverRing: "hover:ring-emerald-500/40",
    text: "text-emerald-300",
  },
  rose: {
    dot: "bg-rose-500 shadow-rose-500/50",
    hoverRing: "hover:ring-rose-500/40",
    text: "text-rose-300",
  },
  fuchsia: {
    dot: "bg-fuchsia-500 shadow-fuchsia-500/50",
    hoverRing: "hover:ring-fuchsia-500/40",
    text: "text-fuchsia-300",
  },
} as const;

type Node = {
  id: string;
  label: string;
  sub: string;
  count?: number;
  accent: keyof typeof ACCENTS;
};

export function PipelineRail() {
  const [counts, setCounts] = useState<Counts | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/command-center", { cache: "no-store" });
    if (res.ok) {
      const body = await res.json();
      setCounts(body.counts as Counts);
    }
  }, []);

  useEffect(() => {
    void load();
    const onRan = () => void load();
    window.addEventListener("decode:ran", onRan);
    window.addEventListener("decode:discovered", onRan);
    return () => {
      window.removeEventListener("decode:ran", onRan);
      window.removeEventListener("decode:discovered", onRan);
    };
  }, [load]);

  const nodes: Node[] = [
    {
      id: "discover",
      label: "Discover",
      sub: "signals",
      count: counts?.signals,
      accent: "indigo",
    },
    {
      id: "observe",
      label: "Observe",
      sub: "insights",
      count: counts?.insights,
      accent: "sky",
    },
    {
      id: "decide",
      label: "Decide",
      sub: "decisions",
      count: counts?.decisions,
      accent: "amber",
    },
    {
      id: "execute",
      label: "Execute",
      sub: "drafts",
      count: counts?.executions,
      accent: "emerald",
    },
    {
      id: "content-queue",
      label: "Review",
      sub: "ready",
      count: counts?.contentQueue,
      accent: "amber",
    },
    { id: "research", label: "Research", sub: "topics", accent: "rose" },
    { id: "publish", label: "Publish", sub: "channels", accent: "fuchsia" },
  ];

  return (
    <div className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto max-w-[1600px] px-4 py-3">
        <div className="flex items-stretch gap-1 overflow-x-auto">
          {nodes.map((n, i) => {
            const a = ACCENTS[n.accent];
            return (
              <div key={n.id} className="flex shrink-0 items-center">
                <a
                  href={`#${n.id}`}
                  className={`group flex min-w-[120px] flex-col gap-1 rounded-lg px-3 py-2 ring-1 ring-neutral-800 transition hover:bg-neutral-900 ${a.hoverRing}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full shadow-[0_0_8px] ${a.dot}`}
                    />
                    <span className="text-sm font-medium text-neutral-100 group-hover:text-white">
                      {n.label}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5 pl-[18px]">
                    <span
                      className={`text-base font-semibold tabular-nums ${
                        n.count === undefined ? "text-neutral-600" : a.text
                      }`}
                    >
                      {n.count ?? "—"}
                    </span>
                    <span className="text-[11px] text-neutral-500">{n.sub}</span>
                  </div>
                </a>
                {i < nodes.length - 1 && (
                  <span
                    aria-hidden
                    className="mx-0.5 select-none text-lg text-neutral-700"
                  >
                    →
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const STAGE_ACCENTS = [
  "ring-indigo-500/40 text-indigo-300",
  "ring-sky-500/40 text-sky-300",
  "ring-rose-500/40 text-rose-300",
  "ring-fuchsia-500/40 text-fuchsia-300",
];

export function Stage({
  n,
  id,
  last,
  children,
}: {
  n: number;
  id: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  const accent = STAGE_ACCENTS[(n - 1) % STAGE_ACCENTS.length];
  return (
    <section id={id} className="mx-auto max-w-[1600px] scroll-mt-20 px-4">
      <div className="flex gap-4">
        {/* Gutter: numbered node + connector line */}
        <div className="flex w-9 shrink-0 flex-col items-center pt-8">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold tabular-nums ring-1 ${accent}`}
          >
            {n}
          </span>
          {!last && (
            <span
              aria-hidden
              className="mt-2 w-px flex-1 bg-gradient-to-b from-neutral-700 to-neutral-800/0"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </section>
  );
}
