"use client";

import { useCallback, useEffect, useState } from "react";

type Listing = {
  id: string;
  area: string;
  address: string;
  postcode: string;
  propertyType: string;
  beds: number | null;
  sizeSqm: number | null;
  askingPrice: number;
  url: string;
  status: string;
  fairValue: number | null;
  dealPct: number | null;
  dealScore: number;
};

const AREAS = [
  { key: "", label: "All areas" },
  { key: "east-belfast", label: "East Belfast" },
  { key: "south-belfast", label: "South Belfast" },
];

const EMPTY = {
  address: "",
  postcode: "",
  askingPrice: "",
  sizeSqm: "",
  beds: "",
  propertyType: "",
  url: "",
  hasGarden: false,
  hasGarage: false,
};

function gbp(n: number | null): string {
  return n == null ? "—" : `£${Math.round(n).toLocaleString()}`;
}

function dealTone(pct: number | null): string {
  if (pct == null) return "text-neutral-500";
  if (pct >= 10) return "text-emerald-400";
  if (pct >= 0) return "text-emerald-300/70";
  if (pct > -10) return "text-amber-300";
  return "text-red-400";
}

export default function PropertyDashboard() {
  const [rows, setRows] = useState<Listing[]>([]);
  const [refCount, setRefCount] = useState(0);
  const [area, setArea] = useState("");
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/property/listings?area=${area}`, {
      cache: "no-store",
    });
    if (res.ok) {
      const b = await res.json();
      setRows(b.rows);
      setRefCount(b.reference.postcodes);
    }
  }, [area]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshReference = useCallback(async () => {
    setBusy("reference");
    setError(null);
    try {
      const res = await fetch("/api/property/reference", { method: "POST" });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? "failed");
      setMsg(`Loaded LPS data ${b.quarter}: ${b.postcodes} postcodes, ${b.coefs} coefficients`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy("");
    }
  }, [load]);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setBusy("import");
      setError(null);
      try {
        const res = await fetch("/api/property/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(form),
        });
        const b = await res.json();
        if (!res.ok) throw new Error(b.error ?? "import failed");
        const l = b.listings[0] as Listing;
        setMsg(
          `Saved: ${l.address} — asking ${gbp(l.askingPrice)}, fair ${gbp(l.fairValue)} (${l.dealPct ?? 0}% ${(l.dealPct ?? 0) >= 0 ? "under" : "over"})`,
        );
        setForm({ ...EMPTY });
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "import failed");
      } finally {
        setBusy("");
      }
    },
    [form, load],
  );

  const set = (k: keyof typeof EMPTY, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Belfast Property Intel{" "}
            <span className="text-neutral-500">· East &amp; South</span>
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            Asking price vs LPS-modelled fair value — find what&apos;s underpriced.
          </p>
        </div>
        <button
          onClick={refreshReference}
          disabled={busy === "reference"}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
        >
          {busy === "reference" ? "Loading LPS…" : `Refresh LPS data (${refCount} postcodes)`}
        </button>
      </header>

      {error && (
        <div className="mt-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/30">
          {error}
        </div>
      )}
      {msg && (
        <div className="mt-4 rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300 ring-1 ring-emerald-500/30">
          {msg}
        </div>
      )}

      {/* Add a listing (manual/assisted import) */}
      <form
        onSubmit={submit}
        className="mt-6 grid grid-cols-2 gap-3 rounded-lg bg-neutral-900 p-4 ring-1 ring-neutral-800 sm:grid-cols-4"
      >
        <input required placeholder="address" value={form.address} onChange={(e) => set("address", e.target.value)} className="col-span-2 rounded-md bg-neutral-950 px-3 py-2 text-sm ring-1 ring-neutral-800" />
        <input required placeholder="postcode (BT5 6AB)" value={form.postcode} onChange={(e) => set("postcode", e.target.value)} className="rounded-md bg-neutral-950 px-3 py-2 text-sm ring-1 ring-neutral-800" />
        <input required type="number" placeholder="asking £" value={form.askingPrice} onChange={(e) => set("askingPrice", e.target.value)} className="rounded-md bg-neutral-950 px-3 py-2 text-sm ring-1 ring-neutral-800" />
        <input type="number" placeholder="size m²" value={form.sizeSqm} onChange={(e) => set("sizeSqm", e.target.value)} className="rounded-md bg-neutral-950 px-3 py-2 text-sm ring-1 ring-neutral-800" />
        <input type="number" placeholder="beds" value={form.beds} onChange={(e) => set("beds", e.target.value)} className="rounded-md bg-neutral-950 px-3 py-2 text-sm ring-1 ring-neutral-800" />
        <input placeholder="type (terrace…)" value={form.propertyType} onChange={(e) => set("propertyType", e.target.value)} className="rounded-md bg-neutral-950 px-3 py-2 text-sm ring-1 ring-neutral-800" />
        <input placeholder="propertypal url" value={form.url} onChange={(e) => set("url", e.target.value)} className="col-span-2 rounded-md bg-neutral-950 px-3 py-2 text-sm ring-1 ring-neutral-800" />
        <label className="flex items-center gap-2 text-xs text-neutral-400">
          <input type="checkbox" checked={form.hasGarden} onChange={(e) => set("hasGarden", e.target.checked)} /> garden
        </label>
        <label className="flex items-center gap-2 text-xs text-neutral-400">
          <input type="checkbox" checked={form.hasGarage} onChange={(e) => set("hasGarage", e.target.checked)} /> garage
        </label>
        <button type="submit" disabled={busy === "import"} className="col-span-2 rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50">
          {busy === "import" ? "Valuing…" : "Add & value listing"}
        </button>
      </form>

      {/* Filter + table */}
      <div className="mt-8 mb-3 flex items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Buying opportunities <span className="text-neutral-600">({rows.length})</span>
        </h2>
        <select value={area} onChange={(e) => setArea(e.target.value)} className="ml-auto rounded-md bg-neutral-900 px-2 py-1.5 text-sm ring-1 ring-neutral-800">
          {AREAS.map((a) => (
            <option key={a.key} value={a.key}>{a.label}</option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-lg ring-1 ring-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900 text-xs uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="px-3 py-2">Address</th>
              <th className="px-3 py-2">Postcode</th>
              <th className="px-3 py-2">Beds/m²</th>
              <th className="px-3 py-2 text-right">Asking</th>
              <th className="px-3 py-2 text-right">Fair value</th>
              <th className="px-3 py-2 text-right">Deal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/70">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-neutral-900/50">
                <td className="px-3 py-2">
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-neutral-100 hover:text-indigo-300 hover:underline">
                      {r.address}
                    </a>
                  ) : (
                    r.address
                  )}
                  <span className="ml-2 text-xs text-neutral-600">{r.area}</span>
                </td>
                <td className="px-3 py-2 text-neutral-400">{r.postcode}</td>
                <td className="px-3 py-2 text-neutral-400">
                  {r.beds ?? "—"}{r.sizeSqm ? ` · ${r.sizeSqm}m²` : ""}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{gbp(r.askingPrice)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{gbp(r.fairValue)}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-medium ${dealTone(r.dealPct)}`}>
                  {r.dealPct == null ? "—" : `${r.dealPct > 0 ? "+" : ""}${r.dealPct}%`}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-neutral-500">
                  No listings yet. Refresh LPS data, then add a listing above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
