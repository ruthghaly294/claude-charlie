"use client";

import { useCallback, useEffect, useState } from "react";

type Variant = {
  id: string;
  label: string;
  description: string;
  template: string;
  builtin: boolean;
};
type Stage = { key: string; label: string; description: string; variants: Variant[] };

type Draft = { label: string; description: string; template: string };

export default function VariantsManager() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newDraft, setNewDraft] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/prompts/variants");
      const json = (await r.json()) as { stages?: Stage[] };
      const s = json.stages ?? [];
      setStages(s);
      const d: Record<string, Draft> = {};
      for (const stage of s) {
        for (const v of stage.variants) {
          if (v.id === "default") continue;
          d[`${stage.key}:${v.id}`] = { label: v.label, description: v.description, template: v.template };
        }
      }
      setDrafts(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function flash(msg: string) {
    setNote(msg);
    setTimeout(() => setNote((n) => (n === msg ? null : n)), 2500);
  }

  async function send(method: string, body: unknown, label: string) {
    setBusy(label);
    setError(null);
    try {
      const r = await fetch("/api/prompts/variants", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await r.json()) as { error?: string; warning?: string };
      if (json.error) {
        setError(json.error);
        return false;
      }
      if (json.warning) flash(`Saved — ⚠ ${json.warning}`);
      else flash("Saved");
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function remove(key: string, id: string) {
    setBusy(`del:${key}:${id}`);
    setError(null);
    try {
      const r = await fetch(`/api/prompts/variants?key=${encodeURIComponent(key)}&id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = (await r.json()) as { error?: string };
      if (json.error) {
        setError(json.error);
        return;
      }
      flash("Deleted");
      await load();
    } finally {
      setBusy(null);
    }
  }

  function nd(key: string): Draft {
    return newDraft[key] ?? { label: "", description: "", template: "" };
  }

  return (
    <div className="mx-auto max-w-[900px] px-4 pb-16">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Prompt Variants</h2>
        <button
          onClick={() => void send("POST", { restore: true }, "restore")}
          disabled={busy === "restore"}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 disabled:opacity-50"
        >
          {busy === "restore" ? "Restoring…" : "Restore built-ins"}
        </button>
      </div>
      <p className="mt-1 text-sm text-neutral-400">
        The angles shown in each trend-page stage dropdown. Edit, add, or delete them. Keep the
        listed placeholders or generation breaks — the server warns if you drop one.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}
      {note && (
        <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">{note}</div>
      )}
      {loading && <p className="mt-6 text-sm text-neutral-500">Loading…</p>}

      <div className="mt-5 space-y-8">
        {stages.map((stage) => (
          <section key={stage.key}>
            <h3 className="text-sm font-semibold text-neutral-100">{stage.label}</h3>
            <p className="mb-3 text-xs text-neutral-500">{stage.description}</p>

            <div className="space-y-3">
              {stage.variants
                .filter((v) => v.id !== "default")
                .map((v) => {
                  const dk = `${stage.key}:${v.id}`;
                  const d = drafts[dk] ?? { label: v.label, description: v.description, template: v.template };
                  const dirty = d.label !== v.label || d.description !== v.description || d.template !== v.template;
                  return (
                    <div key={v.id} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <input
                          value={d.label}
                          onChange={(e) => setDrafts((s) => ({ ...s, [dk]: { ...d, label: e.target.value } }))}
                          className="flex-1 rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-neutral-600"
                        />
                        {v.builtin && (
                          <span className="rounded border border-neutral-700 bg-neutral-800/60 px-1.5 py-0.5 text-[10px] text-neutral-400">built-in</span>
                        )}
                      </div>
                      <input
                        value={d.description}
                        placeholder="short description (shown on hover)"
                        onChange={(e) => setDrafts((s) => ({ ...s, [dk]: { ...d, description: e.target.value } }))}
                        className="mb-2 w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-300 outline-none focus:border-neutral-600"
                      />
                      <textarea
                        value={d.template}
                        onChange={(e) => setDrafts((s) => ({ ...s, [dk]: { ...d, template: e.target.value } }))}
                        rows={6}
                        className="w-full rounded border border-neutral-800 bg-neutral-950 p-2 font-mono text-xs text-neutral-200 outline-none focus:border-neutral-600"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => void send("PATCH", { key: stage.key, id: v.id, ...d }, dk)}
                          disabled={busy === dk || !dirty}
                          className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
                        >
                          {busy === dk ? "Saving…" : "Save"}
                        </button>
                        <button
                          onClick={() => void remove(stage.key, v.id)}
                          disabled={busy === `del:${stage.key}:${v.id}`}
                          className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-300 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>

            <details className="mt-3 rounded-lg border border-dashed border-neutral-800 p-3">
              <summary className="cursor-pointer text-xs font-medium text-neutral-400">+ Add variant</summary>
              <div className="mt-3 space-y-2">
                <input
                  value={nd(stage.key).label}
                  placeholder="label (e.g. Punchy)"
                  onChange={(e) => setNewDraft((s) => ({ ...s, [stage.key]: { ...nd(stage.key), label: e.target.value } }))}
                  className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-neutral-600"
                />
                <input
                  value={nd(stage.key).description}
                  placeholder="short description"
                  onChange={(e) => setNewDraft((s) => ({ ...s, [stage.key]: { ...nd(stage.key), description: e.target.value } }))}
                  className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-300 outline-none focus:border-neutral-600"
                />
                <textarea
                  value={nd(stage.key).template}
                  placeholder="prompt template — keep the stage's placeholders"
                  onChange={(e) => setNewDraft((s) => ({ ...s, [stage.key]: { ...nd(stage.key), template: e.target.value } }))}
                  rows={6}
                  className="w-full rounded border border-neutral-800 bg-neutral-950 p-2 font-mono text-xs text-neutral-200 outline-none focus:border-neutral-600"
                />
                <button
                  onClick={async () => {
                    const ok = await send("POST", { key: stage.key, ...nd(stage.key) }, `new:${stage.key}`);
                    if (ok) setNewDraft((s) => ({ ...s, [stage.key]: { label: "", description: "", template: "" } }));
                  }}
                  disabled={busy === `new:${stage.key}` || !nd(stage.key).label.trim() || !nd(stage.key).template.trim()}
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
                >
                  {busy === `new:${stage.key}` ? "Adding…" : "Add variant"}
                </button>
              </div>
            </details>
          </section>
        ))}
      </div>
    </div>
  );
}
