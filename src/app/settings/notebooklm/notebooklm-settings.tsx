"use client";

import { useEffect, useState } from "react";

type Settings = { enabled: boolean; mode: "discovery" | "existing"; notebookId: string; cookiesPresent: boolean };
type AuthStatus = { cookiesPresent: boolean; authValid: boolean };

export default function NotebookLmSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [cookies, setCookies] = useState("");
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [s, a] = await Promise.all([
        fetch("/api/notebooklm/settings").then((r) => r.json() as Promise<Settings>),
        fetch("/api/notebooklm/auth").then((r) => r.json() as Promise<AuthStatus>),
      ]);
      setSettings(s);
      setAuth(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveSettings() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch("/api/notebooklm/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: settings.enabled, mode: settings.mode, notebookId: settings.notebookId }),
      });
      const json = (await r.json()) as { error?: string };
      if (json.error) setError(json.error);
      else setNotice("Settings saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function importCookies() {
    setImportBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch("/api/notebooklm/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cookies }),
      });
      const json = (await r.json()) as {
        error?: string;
        detail?: string;
        authValid?: boolean;
        missing?: string[];
        output?: string;
      };
      if (json.error) {
        setError(json.detail ? `${json.error}: ${json.detail}` : json.error);
        return;
      }
      setCookies("");
      const missingNote = json.missing && json.missing.length ? ` (missing: ${json.missing.join(", ")})` : "";
      setNotice(`${json.output ?? "Imported."} — auth ${json.authValid ? "VALID" : "unverified"}${missingNote}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[900px] px-4 py-8">
      <h1 className="text-xl font-semibold tracking-tight">NotebookLM</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Outsource research to a Google NotebookLM notebook: distil an insight from your sources and feed it into the
        trend-imitation brief. Sign in by importing your Google cookies (Cookie-Editor → Export → JSON). Cookies are
        written to <code className="text-neutral-300">~/.notebooklm/storage_state.json</code> on the server and never
        stored in the database.
      </p>

      {error && (
        <div className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {settings && (
        <div className="mt-6 space-y-6">
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="font-medium text-neutral-100">Authentication</span>
              <span
                className={
                  "rounded border px-1.5 py-0.5 text-xs " +
                  (auth?.authValid
                    ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                    : auth?.cookiesPresent
                      ? "border-amber-500/30 bg-amber-500/15 text-amber-300"
                      : "border-neutral-700 bg-neutral-800 text-neutral-400")
                }
              >
                {auth?.authValid ? "auth valid" : auth?.cookiesPresent ? "cookies imported (unverified)" : "no cookies"}
              </span>
            </div>
            <p className="mb-2 text-xs text-neutral-500">
              Paste the Cookie-Editor JSON export from notebooklm.google.com (logged into Google).
            </p>
            <textarea
              value={cookies}
              onChange={(e) => setCookies(e.target.value)}
              rows={8}
              placeholder='[ { "name": "SID", "value": "…", "domain": ".google.com", … }, … ]'
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 p-2 font-mono text-xs text-neutral-200 outline-none focus:border-neutral-600"
            />
            <button
              onClick={importCookies}
              disabled={importBusy || !cookies.trim()}
              className="mt-2 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
            >
              {importBusy ? "Importing…" : "Import cookies & test auth"}
            </button>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
            <div className="mb-3 font-medium text-neutral-100">Insight layer</div>

            <label className="flex items-center gap-2 text-sm text-neutral-200">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              />
              Enable NotebookLM insight in the trend pipeline
            </label>

            <div className="mt-4">
              <div className="mb-1 text-xs text-neutral-500">Mode</div>
              <select
                value={settings.mode}
                onChange={(e) => setSettings({ ...settings, mode: e.target.value as Settings["mode"] })}
                className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-600"
              >
                <option value="discovery">Discovery — push this run’s discovered links into the notebook, then query</option>
                <option value="existing">Existing — query a notebook you’ve already filled with sources</option>
              </select>
            </div>

            <div className="mt-4">
              <div className="mb-1 text-xs text-neutral-500">Notebook ID</div>
              <input
                value={settings.notebookId}
                onChange={(e) => setSettings({ ...settings, notebookId: e.target.value })}
                placeholder="e.g. the id from notebooklm.google.com/notebook/<id>"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 font-mono text-xs text-neutral-200 outline-none focus:border-neutral-600"
              />
            </div>

            <button
              onClick={saveSettings}
              disabled={busy}
              className="mt-4 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
