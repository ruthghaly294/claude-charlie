"use client";

import { useEffect, useState } from "react";

type Safe = {
  embeddable: boolean;
  provider: string;
  searchQuery: string;
  trackUrl: string | null;
  licence: string;
};
type Trend = {
  title: string;
  url: string;
  whereTrending: string;
  engagement: number;
  mood: string;
  energy: string;
};
type Sound = { trend: Trend; safe: Safe };
type Resp = { live: boolean; topic: string; sounds: Sound[] };

function fmtUses(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export default function TrendingSounds() {
  const [data, setData] = useState<Resp | null>(null);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);

  async function load(t?: string) {
    setLoading(true);
    try {
      const q = t && t.trim() ? `?topic=${encodeURIComponent(t.trim())}` : "";
      const res = await fetch(`/api/trends/sounds${q}`, { cache: "no-store" });
      setData((await res.json()) as Resp);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="rounded-xl bg-neutral-900 p-5 ring-1 ring-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">
            🎵 Trending TikTok Sounds
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            ranked by uses · each mapped to a royalty-free substitute (commercial
            audio is never embedded)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data &&
            (data.live ? (
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-400 ring-1 ring-emerald-500/30">
                ● LIVE
              </span>
            ) : (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-400 ring-1 ring-amber-500/30">
                ● SAMPLE
              </span>
            ))}
        </div>
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load(topic);
        }}
      >
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="filter by topic (optional)…"
          className="flex-1 rounded-lg bg-neutral-950 px-3 py-2 text-sm ring-1 ring-neutral-800 placeholder:text-neutral-600 focus:outline-none focus:ring-neutral-600"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </form>

      {!data && (
        <p className="mt-4 text-sm text-neutral-500">Loading trending sounds…</p>
      )}

      {data && !data.live && (
        <p className="mt-3 rounded-lg bg-amber-500/5 px-3 py-2 text-xs text-amber-300/80 ring-1 ring-amber-500/20">
          Live TikTok chart is unreachable from this environment (datacenter IP
          blocked / no <code>TIKTOK_CC_TOKEN</code>). Showing a labeled sample
          set — it switches to LIVE automatically once a working source is
          available.
        </p>
      )}

      <ol className="mt-4 space-y-2">
        {data?.sounds.map((s, i) => (
          <li
            key={s.trend.url || s.trend.title}
            className="rounded-lg bg-neutral-950 px-3 py-2.5 ring-1 ring-neutral-800"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs tabular-nums text-neutral-600">
                    #{i + 1}
                  </span>
                  <a
                    href={s.trend.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {s.trend.title}
                  </a>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
                  <span className="rounded bg-neutral-800 px-1.5 py-0.5">
                    {s.trend.mood}/{s.trend.energy}
                  </span>
                  <span>{fmtUses(s.trend.engagement)} uses</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                {s.safe.embeddable && s.safe.trackUrl ? (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-400 ring-1 ring-emerald-500/30">
                    ✓ royalty-free ready
                  </span>
                ) : (
                  <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400">
                    {s.safe.provider}: search
                  </span>
                )}
                <div className="mt-1 max-w-[180px] truncate text-[10px] text-neutral-600">
                  {s.safe.embeddable ? s.safe.trackUrl : s.safe.searchQuery}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
