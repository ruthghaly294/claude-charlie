"use client";

import { useCallback, useEffect, useState } from "react";

type Site = {
  id: string;
  label: string;
  domain: string;
  competitors: string[];
  keywords: string[];
};

type Recommendation = {
  id: string;
  category: string;
  title: string;
  detail: string;
  executionSteps: string[];
  impact: "high" | "medium" | "low";
  effort: "high" | "medium" | "low";
  status: string;
  isNew: boolean;
};

type Ranking = {
  keyword: string;
  position: number | null;
  competitorsAhead: string[];
};

type Scores = { seo: number; geo: number; competitor: number; overall: number };
type Audit = { id: string; status: string; scores: Scores | null; summary: string; finishedAt: string | null };
type ProviderStatus = { key: string; configured: boolean; reason?: string };

const IMPACT_COLOR: Record<string, string> = {
  high: "bg-red-500/15 text-red-300 border-red-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  low: "bg-neutral-500/15 text-neutral-300 border-neutral-500/30",
};

function ScoreBadge({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? "text-emerald-400" : value >= 50 ? "text-amber-400" : "text-red-400";
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

export default function SeoDashboard() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [domain, setDomain] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [keywords, setKeywords] = useState("");
  const [audit, setAudit] = useState<Audit | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSites = useCallback(async () => {
    const res = await fetch("/api/seo/sites", { cache: "no-store" });
    if (res.ok) {
      const b = (await res.json()) as { sites: Site[] };
      setSites(b.sites);
      if (b.sites.length > 0 && !siteId) setSiteId(b.sites[0]!.id);
    }
  }, [siteId]);

  const loadRecs = useCallback(async (id: string) => {
    if (!id) return;
    const res = await fetch(`/api/seo/recommendations?siteId=${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (res.ok) {
      const b = await res.json();
      setAudit(b.audit);
      setRecs(b.recommendations);
      setRankings(b.rankings);
      setProviders(b.providers);
    }
  }, []);

  useEffect(() => void loadSites(), [loadSites]);
  useEffect(() => void loadRecs(siteId), [siteId, loadRecs]);

  const runAudit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const body = siteId
        ? { siteId }
        : {
            domain,
            competitors: competitors.split(",").map((s) => s.trim()).filter(Boolean),
            keywords: keywords.split(",").map((s) => s.trim()).filter(Boolean),
          };
      const res = await fetch("/api/seo/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? "audit failed");
      await loadSites();
      const id = b.summary.siteId as string;
      setSiteId(id);
      await loadRecs(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "audit failed");
    } finally {
      setBusy(false);
    }
  }, [siteId, domain, competitors, keywords, loadSites, loadRecs]);

  const setStatus = useCallback(
    async (id: string, status: string) => {
      await fetch("/api/seo/recommendations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      setRecs((rs) => rs.filter((r) => r.id !== id));
    },
    [],
  );

  const newCount = recs.filter((r) => r.isNew).length;

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-8 text-neutral-200">
      <h1 className="text-xl font-semibold">SEO &amp; GEO Assistant</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Crawl your site + competitors, audit on-page SEO and AI-chatbot (GEO) readiness, and keep a
        running to-do list that only shows what you haven&apos;t done yet.
      </p>

      <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Tracked site
            <select
              className="min-w-48 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200"
              value={siteId}
              onChange={(e) => {
                setSiteId(e.target.value);
                setDomain("");
              }}
            >
              <option value="">+ New site…</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label || s.domain}
                </option>
              ))}
            </select>
          </label>

          {!siteId && (
            <>
              <Field label="Your domain" value={domain} onChange={setDomain} placeholder="https://frcrbank.com" />
              <Field label="Competitors (comma-sep)" value={competitors} onChange={setCompetitors} placeholder="https://a.com, https://b.com" />
              <Field label="Keywords (comma-sep)" value={keywords} onChange={setKeywords} placeholder="frcr, radiology exam" />
            </>
          )}

          <button
            onClick={runAudit}
            disabled={busy || (!siteId && !domain)}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? "Auditing…" : "Run audit"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        {providers.length > 0 && (
          <p className="mt-3 text-xs text-neutral-600">
            Providers:{" "}
            {providers.map((p) => (
              <span key={p.key} title={p.reason} className="mr-2">
                {p.configured ? "🟢" : "⚪"} {p.key}
              </span>
            ))}
          </p>
        )}
      </section>

      {audit?.scores && (
        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ScoreBadge label="Overall" value={audit.scores.overall} />
          <ScoreBadge label="SEO" value={audit.scores.seo} />
          <ScoreBadge label="GEO" value={audit.scores.geo} />
          <ScoreBadge label="Competitor" value={audit.scores.competitor} />
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-300">
          To-do list ({recs.length}){newCount > 0 && <span className="ml-2 text-emerald-400">{newCount} new this run</span>}
        </h2>
        <div className="mt-3 space-y-2">
          {recs.length === 0 && (
            <p className="text-sm text-neutral-600">No open recommendations. Run an audit to populate.</p>
          )}
          {recs.map((r) => (
            <div key={r.id} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                {r.isNew && (
                  <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">
                    New
                  </span>
                )}
                <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${IMPACT_COLOR[r.impact]}`}>
                  {r.impact} impact
                </span>
                <span className="text-[10px] uppercase text-neutral-500">{r.category}</span>
                <span className="text-[10px] text-neutral-600">effort: {r.effort}</span>
              </div>
              <div className="mt-1.5 font-medium text-neutral-100">{r.title}</div>
              {r.detail && <p className="mt-1 text-sm text-neutral-400">{r.detail}</p>}
              {r.executionSteps.length > 0 && (
                <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm text-neutral-400">
                  {r.executionSteps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => setStatus(r.id, "done")}
                  className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                >
                  Mark done
                </button>
                <button
                  onClick={() => setStatus(r.id, "dismissed")}
                  className="rounded border border-neutral-800 px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-800"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {rankings.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-neutral-300">Keyword rankings</h2>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs uppercase text-neutral-600">
              <tr>
                <th className="py-1">Keyword</th>
                <th className="py-1">Your position</th>
                <th className="py-1">Competitors ahead</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((r) => (
                <tr key={r.keyword} className="border-t border-neutral-900">
                  <td className="py-1.5">{r.keyword}</td>
                  <td className="py-1.5">{r.position ?? "—"}</td>
                  <td className="py-1.5 text-neutral-500">{r.competitorsAhead.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-neutral-500">
      {label}
      <input
        className="min-w-56 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
