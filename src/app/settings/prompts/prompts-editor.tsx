"use client";

import { useEffect, useState } from "react";

type PromptRow = {
  key: string;
  label: string;
  description: string;
  placeholders: string[];
  template: string;
  override: string | null;
  value: string;
};

export default function PromptsEditor() {
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/prompts");
      const json = (await r.json()) as { prompts?: PromptRow[] };
      const rows = json.prompts ?? [];
      setPrompts(rows);
      setDrafts(Object.fromEntries(rows.map((p) => [p.key, p.value])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(key: string) {
    setBusyKey(key);
    setError(null);
    try {
      const r = await fetch("/api/prompts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, value: drafts[key] }),
      });
      const json = (await r.json()) as { error?: string };
      if (json.error) {
        setError(json.error);
        return;
      }
      await load();
      setSavedKey(key);
      setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  async function reset(key: string) {
    setBusyKey(key);
    setError(null);
    try {
      const r = await fetch("/api/prompts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, reset: true }),
      });
      const json = (await r.json()) as { error?: string };
      if (json.error) {
        setError(json.error);
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="mx-auto max-w-[900px] px-4 py-8">
      <h1 className="text-xl font-semibold tracking-tight">Prompt Templates</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Every prompt the trend-imitation pipeline sends to an LLM or image/video model. Edits are stored as
        overrides — “Reset to default” reverts to the built-in template.
      </p>

      {error && (
        <div className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && <p className="mt-8 text-sm text-neutral-500">Loading…</p>}

      <div className="mt-6 space-y-6">
        {prompts.map((p) => {
          const dirty = drafts[p.key] !== undefined && drafts[p.key] !== p.value;
          return (
            <div key={p.key} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
              <div className="mb-1 flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-neutral-100">{p.label}</span>
                {p.override !== null && (
                  <span className="rounded border border-sky-500/30 bg-sky-500/15 px-1.5 py-0.5 text-xs text-sky-300">
                    overridden
                  </span>
                )}
                {savedKey === p.key && (
                  <span className="rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-300">
                    saved
                  </span>
                )}
              </div>
              <p className="mb-2 text-xs text-neutral-500">{p.description}</p>
              {p.placeholders.length > 0 && (
                <p className="mb-2 text-xs text-neutral-600">
                  placeholders: {p.placeholders.map((ph) => `{${ph}}`).join(", ")}
                </p>
              )}
              <textarea
                value={drafts[p.key] ?? p.value}
                onChange={(e) => setDrafts((d) => ({ ...d, [p.key]: e.target.value }))}
                rows={10}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 p-2 font-mono text-xs text-neutral-200 outline-none focus:border-neutral-600"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => save(p.key)}
                  disabled={busyKey === p.key || !dirty}
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
                >
                  {busyKey === p.key ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => reset(p.key)}
                  disabled={busyKey === p.key || p.override === null}
                  className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 disabled:opacity-50"
                >
                  Reset to default
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
