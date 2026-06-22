"use client";

import { useCallback, useEffect, useState } from "react";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/publishing/mediaModels";

type AssetStyle = "standard" | "infographic";
const ASSET_STYLE_KEY = "trend.assetStyle";

type NbMode = "discovery" | "existing";
type NbSettings = { enabled: boolean; mode: NbMode; notebookId: string; cookiesPresent: boolean };

type Mode = "demo" | "dry-run" | "live";
type StageName =
  | "research"
  | "exemplars"
  | "insight"
  | "music"
  | "brief"
  | "decision"
  | "cover"
  | "video"
  | "virality"
  | "publish";
const ALL_STAGES: StageName[] = [
  "research",
  "exemplars",
  "insight",
  "music",
  "brief",
  "decision",
  "cover",
  "video",
  "virality",
  "publish",
];
type StageEvent = { stage: StageName; data: unknown };
type RunResult = {
  status: string;
  viralityScore: number | null;
  ideaScore: number | null;
  passed: boolean;
  soundsCatalogued: number;
  videoUrl: string;
};
type ApiResponse = {
  topic: string;
  mode: Mode;
  stages: StageEvent[];
  result?: RunResult;
  error?: string;
  runId?: string;
  async?: boolean;
};

type RunStatus = "pending" | "running" | "ok" | "failed" | "awaiting_review";
type RunRecord = {
  id: string;
  topic: string;
  mode: Mode;
  assetStyle: AssetStyle;
  status: RunStatus;
  stages: StageEvent[];
  generatedVideoId: string | null;
  error: string | null;
  renderContext?: { coverPrompt?: string; videoPrompt?: string } | null;
  createdAt: string;
  updatedAt: string;
};

type Summary =
  | { kind: "sync"; result: RunResult }
  | { kind: "live"; status: RunRecord["status"]; generatedVideoId: string | null };

type Prompt = { system: string; user: string };

type VariantOption = { id: string; label: string; description: string };
type VariantStage = { key: string; label: string; description: string; variants: VariantOption[] };

const STAGE_META: Record<StageName, { n: number; title: string; sub: string }> = {
  research: { n: 1, title: "Research", sub: "what's trending on this topic" },
  exemplars: { n: 2, title: "Recipes", sub: "why the top performers worked (imitate)" },
  insight: { n: 2, title: "Insight", sub: "NotebookLM distilled research (outsourced)" },
  music: { n: 3, title: "Music", sub: "trending sounds → safe royalty-free match" },
  brief: { n: 4, title: "Brief", sub: "our fresh take (innovate)" },
  decision: { n: 5, title: "Decision gate", sub: "judge before we spend" },
  cover: { n: 6, title: "Cover image", sub: "first frame" },
  video: { n: 7, title: "Video", sub: "vertical clip (+ audio)" },
  virality: { n: 8, title: "Virality gate", sub: "will it perform?" },
  publish: { n: 9, title: "Publish", sub: "queue or draft" },
};

const MODE_HELP: Record<Mode, string> = {
  demo: "Instant canned sample — free, no network or credits.",
  "dry-run": "Real trending research + recipes, video stubbed — free, slower.",
  live: "Full run — uses AI + Higgsfield credits, drafts to Buffer if configured.",
};

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" }) {
  const c =
    tone === "good"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
        : "bg-neutral-500/15 text-neutral-300 border-neutral-600/40";
  return <span className={`rounded border px-1.5 py-0.5 text-xs ${c}`}>{children}</span>;
}

/** Read-only disclosure for a {system, user} chat prompt, collapsed by default. */
function PromptDisclosure({ prompt }: { prompt: Prompt | null }) {
  const [open, setOpen] = useState(false);
  if (!prompt) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-neutral-500 underline hover:text-neutral-300"
      >
        {open ? "hide prompt used" : "show prompt used"}
      </button>
      {open && (
        <div className="mt-1 space-y-2 rounded bg-neutral-950/60 p-2 text-xs text-neutral-400">
          <div>
            <div className="text-neutral-600">system:</div>
            <pre className="whitespace-pre-wrap">{prompt.system}</pre>
          </div>
          <div>
            <div className="text-neutral-600">user:</div>
            <pre className="whitespace-pre-wrap">{prompt.user}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

/** Read-only disclosure for a single resolved prompt string (cover/video scaffolds). */
function StringPromptDisclosure({ label, prompt }: { label: string; prompt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-neutral-500 underline hover:text-neutral-300"
      >
        {open ? `hide ${label}` : `show ${label}`}
      </button>
      {open && (
        <pre className="mt-1 whitespace-pre-wrap rounded bg-neutral-950/60 p-2 text-xs text-neutral-400">{prompt}</pre>
      )}
    </div>
  );
}

/** Copy a newline-separated URL list to the clipboard — paste-ready for NotebookLM's "add sources". */
function CopyLinksButton({ links, label = "Copy links for NotebookLM" }: { links: string[]; label?: string }) {
  const [copied, setCopied] = useState(false);
  const unique = Array.from(new Set(links.filter((u) => /^https?:\/\//.test(u))));
  if (unique.length === 0) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(unique.join("\n"));
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard blocked — non-fatal */
        }
      }}
      className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-200 hover:bg-violet-500/20"
    >
      {copied ? `✓ Copied ${unique.length}` : `${label} (${unique.length})`}
    </button>
  );
}

function StageBody({ stage, data }: StageEvent) {
  if (stage === "research") {
    const picks = data as { title: string; source: string; score: number; url?: string }[];
    return (
      <div>
        <ul className="space-y-1">
          {picks.length === 0 && <li className="text-neutral-500">no top picks</li>}
          {picks.slice(0, 6).map((p, i) => (
            <li key={i} className="text-sm">
              <Pill>{p.source}</Pill> <span className="text-neutral-200">{p.title}</span>{" "}
              <span className="text-neutral-500">score {p.score}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2">
          <CopyLinksButton links={picks.map((p) => p.url ?? "").filter(Boolean)} />
        </div>
      </div>
    );
  }
  if (stage === "exemplars") {
    const { items, prompt } = data as {
      items: { hookType: string; format: string; visualStyle: string; pacing: string; cta: string; soundMood: string }[];
      prompt: Prompt | null;
    };
    return (
      <div>
        <ul className="space-y-2">
          {items.map((e, i) => (
            <li key={i} className="text-sm">
              <Pill tone="warn">{e.hookType}</Pill> <Pill>{e.format}</Pill> <Pill>sound: {e.soundMood}</Pill>
              <div className="text-neutral-500">
                visual: {e.visualStyle} · pacing: {e.pacing} · cta: {e.cta}
              </div>
            </li>
          ))}
        </ul>
        <PromptDisclosure prompt={prompt} />
      </div>
    );
  }
  if (stage === "insight") {
    const ins = data as {
      text: string;
      citations: string[];
      notebookId?: string;
      mode?: "discovery" | "existing";
      prompt?: string;
      addedSources?: string[];
    };
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          {ins.mode && <Pill>{ins.mode}</Pill>}
          {ins.notebookId && <span className="font-mono">notebook {ins.notebookId.slice(0, 8)}…</span>}
          <span>
            {ins.text.length.toLocaleString()} chars · {ins.citations.length} citation
            {ins.citations.length === 1 ? "" : "s"}
          </span>
        </div>

        {/* ── what went IN ── */}
        {ins.addedSources && ins.addedSources.length > 0 && (
          <details className="text-xs text-neutral-500">
            <summary className="cursor-pointer hover:text-neutral-300">
              sources pushed in ({ins.addedSources.length})
            </summary>
            <ul className="mt-1 ml-4 list-disc break-all text-neutral-400">
              {ins.addedSources.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </details>
        )}
        {ins.prompt && <StringPromptDisclosure label="prompt sent to NotebookLM" prompt={ins.prompt} />}

        {/* ── what came OUT ── */}
        <div>
          <div className="text-xs text-neutral-600">insight returned:</div>
          <p className="mt-1 whitespace-pre-wrap rounded bg-neutral-950/60 p-2 text-sm text-neutral-200">
            {ins.text || <span className="text-amber-300">(empty answer)</span>}
          </p>
        </div>
        {ins.citations.length > 0 && (
          <div className="text-xs text-neutral-500">
            <div className="text-neutral-600">citations:</div>
            <ul className="ml-4 list-disc space-y-0.5 text-neutral-400">
              {ins.citations.map((c, i) => (
                <li key={i} className="break-words">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (stage === "music") {
    const tracks = data as { trend: { title: string; whereTrending: string; mood: string; energy: string; soundId?: string }; safe: { embeddable: boolean; provider: string; searchQuery: string; trackUrl: string | null } }[];
    return (
      <ul className="space-y-2">
        {tracks.slice(0, 8).map((t, i) => (
          <li key={i} className="text-sm">
            <span className="text-neutral-200">{t.trend.title}</span>{" "}
            <span className="text-neutral-500">
              [{t.trend.whereTrending}, {t.trend.mood}/{t.trend.energy}]
            </span>
            {t.trend.soundId && (
              <span className="ml-1 text-xs text-emerald-400">♪ sound id {t.trend.soundId} (attach in-app)</span>
            )}
            <div className="text-neutral-400">
              safe →{" "}
              {t.safe.embeddable && t.safe.trackUrl ? (
                <Pill tone="good">{t.safe.trackUrl}</Pill>
              ) : (
                <span className="text-amber-300">
                  search {t.safe.provider}: &quot;{t.safe.searchQuery}&quot;
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  }
  if (stage === "brief") {
    const { brief: b, prompt } = data as {
      brief: { hook: string; caption: string; hashtags: string[]; soundMood: string; shotList: { description: string; durationSec: number }[]; videoPrompt: string };
      prompt: Prompt | null;
    };
    return (
      <div className="space-y-2 text-sm">
        <div>
          <span className="text-neutral-500">hook:</span> <span className="font-medium text-neutral-100">{b.hook}</span>
        </div>
        <ol className="ml-4 list-decimal space-y-0.5 text-neutral-300">
          {b.shotList.map((s, i) => (
            <li key={i}>
              ({s.durationSec}s) {s.description}
            </li>
          ))}
        </ol>
        <div className="text-neutral-300">caption: {b.caption}</div>
        <div className="text-neutral-400">{b.hashtags.map((h) => `#${h}`).join(" ")}</div>
        <div className="text-neutral-500">sound mood: {b.soundMood}</div>
        <div className="rounded bg-neutral-950/60 p-2 text-xs text-neutral-500">{b.videoPrompt}</div>
        <PromptDisclosure prompt={prompt} />
      </div>
    );
  }
  if (stage === "decision") {
    const d = data as { score: number; angle: string; rationale: string; threshold: number; cleared: boolean; prompt: Prompt | null };
    return (
      <div className="space-y-1 text-sm">
        <div>
          score <span className="font-semibold text-neutral-100">{d.score}</span>/100 · threshold {d.threshold} ·{" "}
          <Pill tone={d.cleared ? "good" : "warn"}>{d.cleared ? "PROCEED" : "SKIP (parked)"}</Pill>
        </div>
        <div className="text-neutral-300">angle: {d.angle}</div>
        <div className="text-neutral-500">{d.rationale}</div>
        <PromptDisclosure prompt={d.prompt} />
      </div>
    );
  }
  if (stage === "cover") {
    const c = data as { url: string; prompt: string; model?: string | null };
    return (
      <div className="text-sm">
        <div className="break-all text-sky-300">{c.url}</div>
        {c.model && <div className="mt-1 text-xs text-neutral-500">model: {c.model}</div>}
        <StringPromptDisclosure label="cover prompt" prompt={c.prompt} />
      </div>
    );
  }
  if (stage === "video") {
    const v = data as {
      url: string;
      audioUsed: string | null;
      prompt?: string;
      model?: string | null;
      source?: string;
      provider?: string;
      licence?: string;
    };
    return (
      <div className="space-y-1 text-sm">
        <div className="break-all text-sky-300">{v.url}</div>
        {v.source === "stock" && (
          <div className="text-xs text-emerald-300">
            ♻ reused {v.provider} stock clip · {v.licence}
          </div>
        )}
        {v.model && <div className="text-xs text-neutral-500">model: {v.model}</div>}
        <div className="text-neutral-400">
          audio: {v.audioUsed ? <Pill tone="good">{v.audioUsed}</Pill> : <span className="text-neutral-500">none embedded (add platform sound in-app)</span>}
        </div>
        {v.prompt && <StringPromptDisclosure label="video prompt" prompt={v.prompt} />}
      </div>
    );
  }
  if (stage === "virality") {
    const r = data as { score: number | null; reportUrl: string | null };
    return (
      <div className="text-sm">
        score: <span className="font-semibold text-neutral-100">{r.score ?? "n/a"}</span>
        {r.reportUrl && <span className="ml-2 break-all text-neutral-500">{r.reportUrl}</span>}
      </div>
    );
  }
  const p = data as {
    status: string;
    bufferPostId: string | null;
    channelConfigured: boolean;
    platforms?: { platform: string; postId: string }[];
    duet?: { sourceUrl: string | null; instruction: string } | null;
  };
  return (
    <div className="space-y-1 text-sm">
      <div>
        status: <Pill tone={p.status === "queued" ? "good" : "warn"}>{p.status}</Pill> · buffer post:{" "}
        {p.bufferPostId ?? <span className="text-neutral-500">{p.channelConfigured ? "—" : "(no channel configured)"}</span>}
      </div>
      {p.platforms && p.platforms.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {p.platforms.map((pl) => (
            <Pill key={pl.platform} tone="good">
              {pl.platform}
            </Pill>
          ))}
        </div>
      )}
      {p.duet && (
        <div className="rounded bg-violet-500/10 p-2 text-xs text-violet-200">
          <div className="font-medium">Duet / Stitch — manual in-app step</div>
          <div className="text-violet-300/80">{p.duet.instruction}</div>
        </div>
      )}
    </div>
  );
}

export default function TrendDashboard() {
  const [topic, setTopic] = useState("AI coding tools");
  const [mode, setMode] = useState<Mode>("demo");
  const [assetStyle, setAssetStyle] = useState<AssetStyle>("standard");
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [coverModelKey, setCoverModelKey] = useState("auto");
  const [coverModelCustom, setCoverModelCustom] = useState("");
  const [videoModelKey, setVideoModelKey] = useState("auto");
  const [videoModelCustom, setVideoModelCustom] = useState("");
  // New pipeline knobs (W4/W5/W6) — sent as per-run overrides to /api/trend.
  const [sourceMode, setSourceMode] = useState<"generate" | "stock" | "duet">("generate");
  const [captionOverlay, setCaptionOverlay] = useState(false);
  const [llmVirality, setLlmVirality] = useState(false);
  const [briefVariants, setBriefVariants] = useState(1);
  const [duetSourceUrl, setDuetSourceUrl] = useState("");
  // Per-stage prompt-variant library + the operator's selection ({stageKey: variantId}).
  const [variantStages, setVariantStages] = useState<VariantStage[]>([]);
  const [promptVariants, setPromptVariants] = useState<Record<string, string>>({});
  // Optional pasted research to ground the brief (used alongside auto-discovery).
  const [manualResearch, setManualResearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [stages, setStages] = useState<StageEvent[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [reviewRun, setReviewRun] = useState<RunRecord | null>(null);
  const [coverPromptEdit, setCoverPromptEdit] = useState("");
  const [videoPromptEdit, setVideoPromptEdit] = useState("");
  const [rendering, setRendering] = useState(false);
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nb, setNb] = useState<NbSettings | null>(null);
  const [nbBusy, setNbBusy] = useState(false);
  const [nbError, setNbError] = useState<string | null>(null);

  // NotebookLM insight settings live in the DB and are read by the run at runtime,
  // so toggling here just affects the next run — no change to the run payload needed.
  useEffect(() => {
    let active = true;
    fetch("/api/notebooklm/settings")
      .then((r) => r.json() as Promise<NbSettings>)
      .then((s) => {
        if (active) setNb(s);
      })
      .catch(() => {
        /* non-fatal — the control row just won't render */
      });
    return () => {
      active = false;
    };
  }, []);

  const persistNb = useCallback(async (next: NbSettings) => {
    setNbBusy(true);
    setNbError(null);
    try {
      const r = await fetch("/api/notebooklm/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next.enabled, mode: next.mode, notebookId: next.notebookId }),
      });
      const json = (await r.json()) as { error?: string };
      if (json.error) setNbError(json.error);
    } catch (e) {
      setNbError(e instanceof Error ? e.message : String(e));
    } finally {
      setNbBusy(false);
    }
  }, []);

  function updateNb(patch: Partial<Pick<NbSettings, "enabled" | "mode" | "notebookId">>) {
    if (!nb) return;
    const next = { ...nb, ...patch };
    setNb(next);
    void persistNb(next);
  }

  // Persist the asset-style choice across sessions (loaded after mount to avoid SSR mismatch).
  useEffect(() => {
    const saved = localStorage.getItem(ASSET_STYLE_KEY);
    if (saved === "infographic" || saved === "standard") setAssetStyle(saved);
  }, []);
  useEffect(() => {
    localStorage.setItem(ASSET_STYLE_KEY, assetStyle);
  }, [assetStyle]);

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/trend");
      const json = (await r.json()) as { runs?: RunRecord[] };
      setHistory(json.runs ?? []);
    } catch {
      /* non-fatal */
    }
  }, []);
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/prompts/variants");
        const json = (await r.json()) as { stages?: VariantStage[] };
        setVariantStages(json.stages ?? []);
      } catch {
        /* non-fatal — dropdowns just won't render */
      }
    })();
  }, []);

  // Live runs are async: POST returns a runId, then we poll the worker's progress.
  useEffect(() => {
    if (!runId) return;
    let active = true;
    const poll = async () => {
      try {
        const r = await fetch(`/api/trend?runId=${runId}`);
        const json = (await r.json()) as { run?: RunRecord };
        const run = json.run;
        if (!active || !run) return;
        setStages(run.stages ?? []);
        if (run.status === "ok" || run.status === "failed") {
          setSummary({ kind: "live", status: run.status, generatedVideoId: run.generatedVideoId });
          if (run.error) setError(run.error);
          setLoading(false);
          setRunId(null);
          void loadHistory();
        } else if (run.status === "awaiting_review") {
          setReviewRun(run);
          setCoverPromptEdit(run.renderContext?.coverPrompt ?? "");
          setVideoPromptEdit(run.renderContext?.videoPrompt ?? "");
          setLoading(false);
          setRunId(null); // stop polling until the operator clicks Render
        }
      } catch {
        /* keep polling */
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 2000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [runId, loadHistory]);

  async function run() {
    setLoading(true);
    setError(null);
    setStages([]);
    setSummary(null);
    setRunId(null);
    setReviewRun(null);
    try {
      const r = await fetch("/api/trend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic,
          mode,
          assetStyle,
          reviewEnabled: mode === "live" && reviewEnabled,
          coverModelKey,
          coverModelCustom,
          videoModelKey,
          videoModelCustom,
          sourceMode,
          captionOverlay,
          viralityScorer: llmVirality ? "llm" : undefined,
          briefVariants,
          duetSourceUrl: sourceMode === "duet" ? duetSourceUrl : undefined,
          promptVariants,
          manualResearch: manualResearch.trim() || undefined,
        }),
      });
      const json = (await r.json()) as ApiResponse;
      if (json.error) {
        setError(json.error);
        setStages(json.stages ?? []);
        setLoading(false);
        return;
      }
      if (json.async && json.runId) {
        setRunId(json.runId); // polling effect drives the rest (keeps loading=true)
        return;
      }
      setStages(json.stages ?? []);
      if (json.result) setSummary({ kind: "sync", result: json.result });
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  async function submitRender() {
    if (!reviewRun) return;
    setRendering(true);
    setError(null);
    try {
      const r = await fetch(`/api/trend/${reviewRun.id}/render`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coverPrompt: coverPromptEdit, videoPrompt: videoPromptEdit }),
      });
      const json = (await r.json()) as { error?: string };
      if (json.error) {
        setError(json.error);
        return;
      }
      const resumedRunId = reviewRun.id;
      setReviewRun(null);
      setLoading(true);
      setRunId(resumedRunId); // resumes polling for cover/video/virality/publish stages
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="mx-auto max-w-[900px] px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Trend-Imitation Pipeline</h1>
        <a
          href="/qotd"
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-500"
        >
          Question-of-the-Day →
        </a>
      </div>
      <p className="mt-1 text-sm text-neutral-400">
        Watch a topic travel A→B: trending research → recipes → music → brief → video → virality → publish.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="topic, e.g. gym motivation"
          className="min-w-[240px] flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
        />
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
        >
          <option value="demo">Demo (instant, free)</option>
          <option value="dry-run">Dry-run (real research, free)</option>
          <option value="live">Live (uses credits)</option>
        </select>
        <button
          onClick={run}
          disabled={loading || !topic.trim()}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {loading ? "Running…" : "Run pipeline"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={assetStyle === "infographic"}
            onChange={(e) => setAssetStyle(e.target.checked ? "infographic" : "standard")}
            className="h-4 w-4 accent-emerald-500"
          />
          <span className="font-medium text-neutral-200">Infographic cover</span>
          <span className="text-xs text-neutral-500">— Nano Banana, vertical data-viz (saved as your default)</span>
        </label>

        {mode === "live" && (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={reviewEnabled}
              onChange={(e) => setReviewEnabled(e.target.checked)}
              className="h-4 w-4 accent-sky-500"
            />
            <span className="font-medium text-neutral-200">Pause for review before render</span>
            <span className="text-xs text-neutral-500">— edit cover/video prompts before the expensive render phase</span>
          </label>
        )}
      </div>

      {/* Pipeline options (W4 variants, W5 source lane + captions, W6 virality scorer) */}
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm">
        <label className="inline-flex items-center gap-2">
          <span className="text-neutral-400">Video source</span>
          <select
            value={sourceMode}
            onChange={(e) => setSourceMode(e.target.value as "generate" | "stock" | "duet")}
            className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-600"
          >
            <option value="generate">Generate (AI)</option>
            <option value="stock">Stock reuse (Pexels)</option>
            <option value="duet">Duet / Stitch</option>
          </select>
        </label>

        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={captionOverlay}
            onChange={(e) => setCaptionOverlay(e.target.checked)}
            className="h-4 w-4 accent-emerald-500"
          />
          <span className="text-neutral-300">Burn captions</span>
        </label>

        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={llmVirality}
            onChange={(e) => setLlmVirality(e.target.checked)}
            className="h-4 w-4 accent-sky-500"
          />
          <span className="text-neutral-300">AI virality pre-score</span>
          <span className="text-xs text-neutral-500">(owl-alpha, no paid plan)</span>
        </label>

        <label className="inline-flex items-center gap-2">
          <span className="text-neutral-400">Brief variants</span>
          <input
            type="number"
            min={1}
            max={5}
            value={briefVariants}
            onChange={(e) => setBriefVariants(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
            className="w-14 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-600"
          />
          <span className="text-xs text-neutral-500">best-of-N (key pool)</span>
        </label>

        {sourceMode === "duet" && (
          <input
            value={duetSourceUrl}
            onChange={(e) => setDuetSourceUrl(e.target.value)}
            placeholder="duet source clip URL (e.g. tiktok.com/@…/video/…)"
            className="min-w-[260px] flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-neutral-600"
          />
        )}
      </div>

      {variantStages.length > 0 && (
        <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-medium text-neutral-200">Prompt variants</span>
            <span className="text-xs text-neutral-500">— pick the angle for each stage (default = built-in)</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {variantStages.map((stage) => {
              const selected = promptVariants[stage.key] ?? "default";
              const active = selected !== "default";
              return (
                <label key={stage.key} className="inline-flex flex-col gap-1">
                  <span className="text-xs text-neutral-400">{stage.label}</span>
                  <select
                    value={selected}
                    onChange={(e) =>
                      setPromptVariants((prev) => ({ ...prev, [stage.key]: e.target.value }))
                    }
                    title={stage.description}
                    className={`rounded-lg border bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-600 ${
                      active ? "border-emerald-600/60" : "border-neutral-800"
                    }`}
                  >
                    {stage.variants.map((v) => (
                      <option key={v.id} value={v.id} title={v.description}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <details className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm">
        <summary className="cursor-pointer">
          <span className="font-medium text-neutral-200">Paste research</span>
          <span className="ml-2 text-xs text-neutral-500">
            — optional notes/article text/transcript to ground the brief in real facts
            {manualResearch.trim() ? ` · ${manualResearch.trim().length} chars` : ""}
          </span>
        </summary>
        <textarea
          value={manualResearch}
          onChange={(e) => setManualResearch(e.target.value)}
          rows={6}
          placeholder="Paste your own research here — findings, quotes, figures, an article or transcript. It's fed to the brief as a trusted factual payload (used alongside auto-discovery)."
          className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-xs text-neutral-200 outline-none focus:border-neutral-600"
        />
      </details>

      {nb && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm">
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={nb.enabled}
                onChange={(e) => updateNb({ enabled: e.target.checked })}
                className="h-4 w-4 accent-violet-500"
              />
              <span className="font-medium text-neutral-200">Use NotebookLM insight</span>
            </label>

            <select
              value={nb.mode}
              onChange={(e) => updateNb({ mode: e.target.value as NbMode })}
              disabled={!nb.enabled}
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-600 disabled:opacity-50"
            >
              <option value="discovery">Discovery — push this run’s links in</option>
              <option value="existing">Existing — query a filled notebook</option>
            </select>

            <input
              value={nb.notebookId}
              onChange={(e) => setNb({ ...nb, notebookId: e.target.value })}
              onBlur={() => nb && void persistNb(nb)}
              disabled={!nb.enabled}
              placeholder="notebook id"
              className="min-w-[180px] flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 font-mono text-xs text-neutral-200 outline-none focus:border-neutral-600 disabled:opacity-50"
            />

            <Pill tone={nb.cookiesPresent ? "good" : "warn"}>
              {nb.cookiesPresent ? "cookies imported" : "no cookies"}
            </Pill>
            <a href="/settings/notebooklm" className="text-xs text-sky-400 hover:underline">
              manage →
            </a>
            {nbBusy && <span className="text-xs text-neutral-500">saving…</span>}
          </div>
          {nb.enabled && !nb.cookiesPresent && (
            <p className="mt-1 text-xs text-amber-400">
              NotebookLM is enabled but no cookies are imported — import them in{" "}
              <a href="/settings/notebooklm" className="underline">
                settings
              </a>{" "}
              or the insight stage will be skipped at runtime.
            </p>
          )}
          {nbError && <p className="mt-1 text-xs text-red-400">NotebookLM settings: {nbError}</p>}
        </div>
      )}

      {mode === "live" && (
        <div className="mt-3 flex flex-wrap items-start gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Image model (Replicate)</label>
            <div className="flex gap-2">
              <select
                value={coverModelKey}
                onChange={(e) => setCoverModelKey(e.target.value)}
                className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
              >
                <option value="auto">Auto (configured default)</option>
                {IMAGE_MODELS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label} ({m.tier})
                  </option>
                ))}
                <option value="custom">Custom model…</option>
              </select>
              {coverModelKey === "custom" && (
                <input
                  value={coverModelCustom}
                  onChange={(e) => setCoverModelCustom(e.target.value)}
                  placeholder="owner/model[:version]"
                  className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Video model (Replicate)</label>
            <div className="flex gap-2">
              <select
                value={videoModelKey}
                onChange={(e) => setVideoModelKey(e.target.value)}
                className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
              >
                <option value="auto">Auto (configured default)</option>
                {VIDEO_MODELS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label} ({m.tier})
                  </option>
                ))}
                <option value="custom">Custom model…</option>
              </select>
              {videoModelKey === "custom" && (
                <input
                  value={videoModelCustom}
                  onChange={(e) => setVideoModelCustom(e.target.value)}
                  placeholder="owner/model[:version]"
                  className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
                />
              )}
            </div>
          </div>
        </div>
      )}
      {mode === "live" && (coverModelKey !== "auto" || videoModelKey !== "auto") && (
        <p className="mt-1 text-xs text-amber-400">
          Picking a specific model switches this run to the Replicate provider and may cost more than the configured default.
        </p>
      )}

      <p className="mt-2 text-xs text-neutral-500">{MODE_HELP[mode]}</p>

      {error && (
        <div className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && runId && (
        <div className="mt-5 flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-300">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-400" />
          Running live in the background — progress streams in below. You can leave this page; it keeps going.
        </div>
      )}

      {reviewRun && (
        <div className="mt-5 rounded-lg border border-sky-500/30 bg-sky-500/5 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Pill tone="warn">awaiting review</Pill>
            <span className="text-sm text-neutral-300">
              The idea cleared the gate — edit the cover/video prompts below, then render.
            </span>
          </div>
          <label className="block text-xs text-neutral-500">Cover image prompt</label>
          <textarea
            value={coverPromptEdit}
            onChange={(e) => setCoverPromptEdit(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-xs text-neutral-200 outline-none focus:border-neutral-600"
          />
          <label className="mt-3 block text-xs text-neutral-500">Video prompt</label>
          <textarea
            value={videoPromptEdit}
            onChange={(e) => setVideoPromptEdit(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-xs text-neutral-200 outline-none focus:border-neutral-600"
          />
          <button
            onClick={submitRender}
            disabled={rendering}
            className="mt-3 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
          >
            {rendering ? "Starting render…" : "Render ▶"}
          </button>
        </div>
      )}

      {summary?.kind === "sync" && (
        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-sm">
          <Pill tone={summary.result.passed ? "good" : "warn"}>status: {summary.result.status}</Pill>
          <Pill tone={summary.result.status === "rejected" ? "warn" : "good"}>idea {summary.result.ideaScore ?? "n/a"}</Pill>
          <Pill tone={summary.result.passed ? "good" : "warn"}>virality {summary.result.viralityScore ?? "n/a"}</Pill>
          <Pill>{summary.result.soundsCatalogued} sounds catalogued</Pill>
        </div>
      )}

      {summary?.kind === "live" && (
        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-sm">
          <Pill tone={summary.status === "ok" ? "good" : "warn"}>run {summary.status}</Pill>
          {summary.generatedVideoId ? (
            <a href="/review" className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-black hover:bg-emerald-400">
              View in Review →
            </a>
          ) : (
            <span className="text-xs text-neutral-500">no asset produced (parked or failed)</span>
          )}
        </div>
      )}

      {(stages.length > 0 || loading) && (
        <ol className="mt-6 space-y-0">
          {/* "insight" is an opt-in stage. Show its row once its event arrives, OR proactively
              while a live run with NotebookLM enabled is in flight, so the operator can watch it
              work in real time (it otherwise runs silently for ~1-2 min). */}
          {(stages.some((s) => s.stage === "insight") || (nb?.enabled === true && mode === "live" && loading)
            ? ALL_STAGES
            : ALL_STAGES.filter((s) => s !== "insight")
          ).map((name, i, shown) => {
            const meta = STAGE_META[name];
            const event = stages.find((s) => s.stage === name);
            const done = Boolean(event);
            const isNext = !done && stages.length === i;
            const active = isNext && loading;
            const last = i === shown.length - 1;
            return (
              <li key={name} className="relative flex gap-4">
                <div className="flex flex-col items-center">
                  <div
                    className={
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold " +
                      (done
                        ? "border-emerald-600 bg-emerald-950 text-emerald-300"
                        : active
                          ? "animate-pulse border-sky-500 bg-sky-950 text-sky-300"
                          : "border-neutral-800 bg-neutral-950 text-neutral-600")
                    }
                  >
                    {done ? "✓" : meta.n}
                  </div>
                  {!last && <div className="my-1 w-px flex-1 bg-neutral-800" />}
                </div>
                <div
                  className={
                    "mb-4 flex-1 rounded-lg border p-4 " +
                    (done ? "border-neutral-800 bg-neutral-900/40" : "border-neutral-900 bg-neutral-950/20")
                  }
                >
                  <div className="mb-2 flex items-baseline gap-2">
                    <span className={done ? "font-medium text-neutral-100" : "font-medium text-neutral-500"}>
                      {meta.title}
                    </span>
                    <span className="text-xs text-neutral-500">{meta.sub}</span>
                  </div>
                  {event ? <StageBody stage={event.stage} data={event.data} /> : <span className="text-xs text-neutral-600">pending…</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {stages.length === 0 && !loading && (
        <p className="mt-10 text-center text-sm text-neutral-600">
          Enter a topic and hit “Run pipeline” to see it travel through every stage.
        </p>
      )}

      {history.length > 0 && (
        <div className="mt-10 border-t border-neutral-800 pt-6">
          <h2 className="text-sm font-semibold text-neutral-300">Recent runs</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2">
                <Pill tone={h.status === "ok" ? "good" : h.status === "failed" ? "warn" : "neutral"}>{h.status}</Pill>
                <span className="text-neutral-200">{h.topic}</span>
                <span className="text-xs text-neutral-500">· {h.assetStyle} · {new Date(h.createdAt).toLocaleString()}</span>
                {h.generatedVideoId && (
                  <a href="/review" className="text-xs text-emerald-400 hover:underline">
                    review →
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
