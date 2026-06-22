"use client";

import { useCallback, useEffect, useState } from "react";

type SourceStatus = {
  key: string;
  label: string;
  requiresKeys: string[];
  configured: boolean;
  reason?: string;
  signalCount: number;
};

type SignalRow = {
  id: string;
  source: string;
  title: string;
  url: string;
  score: number | null;
  cluster: string | null;
  status: string;
  capturedAt: string;
};

type SourcesResp = {
  business: { name: string; keywords: string[] };
  sources: SourceStatus[];
  latestRun: { startedAt: string; status: string; totalNew: number } | null;
};

type SignalsResp = { rows: SignalRow[]; total: number; clusters: string[] };

type RunSummary = {
  status: string;
  totalFound: number;
  totalNew: number;
  perSource: {
    source: string;
    status: string;
    found: number;
    added: number;
    error?: string;
  }[];
};

const PAGE = 25;

function Badge({
  tone,
  children,
}: {
  tone: "ok" | "off" | "warn";
  children: React.ReactNode;
}) {
  const tones = {
    ok: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    off: "bg-neutral-500/15 text-neutral-400 ring-neutral-500/30",
    warn: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export default function DiscoverDashboard() {
  const [sources, setSources] = useState<SourcesResp | null>(null);
  const [signals, setSignals] = useState<SignalsResp | null>(null);
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    const res = await fetch("/api/sources", { cache: "no-store" });
    if (res.ok) setSources(await res.json());
  }, []);

  const loadSignals = useCallback(async () => {
    const params = new URLSearchParams({
      limit: String(PAGE),
      offset: String(page * PAGE),
    });
    if (source) params.set("source", source);
    if (q) params.set("q", q);
    const res = await fetch(`/api/signals?${params}`, { cache: "no-store" });
    if (res.ok) setSignals(await res.json());
    else setError("Failed to load signals");
  }, [page, source, q]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);
  useEffect(() => {
    void loadSignals();
  }, [loadSignals]);

  const runDiscovery = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/discover", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "discovery failed");
      setLastRun(body as RunSummary);
      setPage(0);
      window.dispatchEvent(new Event("decode:discovered"));
      await Promise.all([loadSources(), loadSignals()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "discovery failed");
    } finally {
      setRunning(false);
    }
  }, [loadSignals, loadSources]);

  const [copied, setCopied] = useState<number | null>(null);
  const copyResourcesForNotebook = useCallback(async () => {
    // Pull ALL signals matching the current filters (not just the visible page) so the
    // operator can paste the full resource set straight into NotebookLM's "add sources".
    const params = new URLSearchParams({ limit: "500", offset: "0" });
    if (source) params.set("source", source);
    if (q) params.set("q", q);
    const res = await fetch(`/api/signals?${params}`, { cache: "no-store" });
    if (!res.ok) {
      setError("Failed to load signals for copy");
      return;
    }
    const body = (await res.json()) as SignalsResp;
    const urls = Array.from(
      new Set(body.rows.map((r) => r.url).filter((u) => /^https?:\/\//.test(u))),
    );
    if (urls.length === 0) {
      setError("No resource links to copy for this filter");
      return;
    }
    try {
      await navigator.clipboard.writeText(urls.join("\n"));
      setCopied(urls.length);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      setError("Clipboard blocked by the browser");
    }
  }, [source, q]);

  const total = signals?.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE) - 1);

  return (
    <main className="w-full">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            DECODE <span className="text-neutral-500">· Discover</span>
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            {sources?.business.name ?? "…"} — scanning the outside world for
            signals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copyResourcesForNotebook}
            title="Copy every matching signal URL, paste-ready for NotebookLM's add-sources"
            className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm font-medium text-violet-200 hover:bg-violet-500/20"
          >
            {copied != null ? `✓ Copied ${copied} links` : "Copy links for NotebookLM"}
          </button>
          <button
            onClick={runDiscovery}
            disabled={running}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-400 disabled:opacity-50"
          >
            {running ? "Discovering…" : "Run discovery"}
          </button>
        </div>
      </header>

      {error && (
        <div className="mt-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/30">
          {error}
        </div>
      )}

      {lastRun && (
        <div className="mt-4 rounded-lg bg-neutral-900 px-4 py-3 text-sm ring-1 ring-neutral-800">
          Last run:{" "}
          <Badge tone={lastRun.status === "ok" ? "ok" : "warn"}>
            {lastRun.status}
          </Badge>{" "}
          found {lastRun.totalFound}, added <strong>{lastRun.totalNew}</strong>{" "}
          new.
          <span className="ml-2 text-neutral-500">
            {lastRun.perSource
              .filter((p) => p.status !== "skipped")
              .map((p) => `${p.source}:${p.added}`)
              .join("  ·  ")}
          </span>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
        {/* Sources panel */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Sources
          </h2>
          <ul className="space-y-2">
            {sources?.sources.map((s) => (
              <li
                key={s.key}
                className="rounded-lg bg-neutral-900 px-3 py-2.5 ring-1 ring-neutral-800"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{s.label}</span>
                  {s.configured ? (
                    <Badge tone="ok">on</Badge>
                  ) : (
                    <Badge tone="off">off</Badge>
                  )}
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-neutral-500">
                  <span>{s.signalCount} signals</span>
                  {!s.configured && s.reason && (
                    <span className="truncate pl-2">{s.reason}</span>
                  )}
                </div>
                {s.requiresKeys.length > 0 && (
                  <div className="mt-1 text-[11px] text-neutral-600">
                    needs {s.requiresKeys.join(", ")}
                  </div>
                )}
              </li>
            ))}
            {!sources && <li className="text-sm text-neutral-500">Loading…</li>}
          </ul>
        </section>

        {/* Signals panel */}
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Signals <span className="text-neutral-600">({total})</span>
            </h2>
            <div className="ml-auto flex gap-2">
              <select
                value={source}
                onChange={(e) => {
                  setPage(0);
                  setSource(e.target.value);
                }}
                className="rounded-md bg-neutral-900 px-2 py-1.5 text-sm ring-1 ring-neutral-800"
              >
                <option value="">all sources</option>
                {sources?.sources.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <input
                value={q}
                onChange={(e) => {
                  setPage(0);
                  setQ(e.target.value);
                }}
                placeholder="search title…"
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm ring-1 ring-neutral-800 placeholder:text-neutral-600"
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-lg ring-1 ring-neutral-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-900 text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Cluster</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/70">
                {signals?.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-neutral-900/50">
                    <td className="px-3 py-2">
                      {r.url ? (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-neutral-100 hover:text-indigo-300 hover:underline"
                        >
                          {r.title}
                        </a>
                      ) : (
                        r.title
                      )}
                    </td>
                    <td className="px-3 py-2 text-neutral-400">{r.source}</td>
                    <td className="px-3 py-2 tabular-nums text-neutral-300">
                      {r.score?.toFixed(2) ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-neutral-400">
                      {r.cluster ?? "—"}
                    </td>
                  </tr>
                ))}
                {signals && signals.rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-8 text-center text-neutral-500"
                    >
                      No signals yet — hit “Run discovery”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {total > PAGE && (
            <div className="mt-3 flex items-center justify-end gap-3 text-sm text-neutral-400">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-md px-3 py-1 ring-1 ring-neutral-800 disabled:opacity-40"
              >
                Prev
              </button>
              <span>
                {page + 1} / {maxPage + 1}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
                disabled={page >= maxPage}
                className="rounded-md px-3 py-1 ring-1 ring-neutral-800 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
