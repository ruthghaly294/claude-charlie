"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BufferChannel, BufferPost, BufferPostStatus } from "@/publishing/bufferClient";
import type { DraftSeed } from "./research-panel";

function Chip({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ${tone}`}>
      {children}
    </span>
  );
}

function statusTone(status: BufferPostStatus): string {
  if (status === "error") return "bg-rose-500/15 text-rose-300 ring-rose-500/30";
  if (status === "sent") return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30";
  if (status === "sending") return "bg-indigo-500/15 text-indigo-300 ring-indigo-500/30";
  if (status === "draft") return "bg-neutral-700/40 text-neutral-500 ring-neutral-700/50";
  return "bg-neutral-500/15 text-neutral-400 ring-neutral-500/30";
}

const INSTAGRAM_TYPES = ["post", "reel", "story", "carousel"] as const;
type InstagramType = (typeof INSTAGRAM_TYPES)[number];
type ScheduleMode = "queue" | "now" | "schedule";

export default function BufferPanel({ draft }: { draft?: DraftSeed | null }) {
  const [channels, setChannels] = useState<BufferChannel[]>([]);
  const [posts, setPosts] = useState<BufferPost[]>([]);
  const [channelId, setChannelId] = useState("");
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [altText, setAltText] = useState("");
  const [instagramType, setInstagramType] = useState<InstagramType>("post");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("queue");
  const [dueAtLocal, setDueAtLocal] = useState("");
  const [saveToDraft, setSaveToDraft] = useState(false);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [chRes, postsRes] = await Promise.all([
        fetch("/api/buffer/channels", { cache: "no-store" }),
        fetch("/api/buffer/posts", { cache: "no-store" }),
      ]);
      if (chRes.status === 503 || postsRes.status === 503) {
        setNotConfigured(true);
        return;
      }
      setNotConfigured(false);

      const chBody = await chRes.json();
      if (!chRes.ok) throw new Error(chBody.error ?? "failed to load channels");
      setChannels(chBody.rows);

      const postsBody = await postsRes.json();
      if (!postsRes.ok) throw new Error(postsBody.error ?? "failed to load posts");
      setPosts(postsBody.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load Buffer data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (channelId) return;
    const first = channels[0];
    if (first) setChannelId(first.id);
  }, [channels, channelId]);

  useEffect(() => {
    if (!draft) return;
    setText(draft.text);
    setImageUrl(draft.imageUrl ?? "");
    setSaveToDraft((draft.issues?.length ?? 0) > 0);
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [draft]);

  const selectedChannel = channels.find((c) => c.id === channelId);

  const publish = useCallback(async () => {
    if (!channelId || text.trim().length === 0) {
      setError("Pick a channel and enter post text.");
      return;
    }
    if (selectedChannel?.service === "instagram" && !imageUrl.trim()) {
      setError("Instagram posts require an image URL.");
      return;
    }

    setPosting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { channelId, text: text.trim() };
      if (imageUrl.trim()) body.imageUrl = imageUrl.trim();
      if (altText.trim()) body.altText = altText.trim();
      if (selectedChannel?.service === "instagram") body.instagramType = instagramType;
      if (scheduleMode === "now") body.shareNow = true;
      if (scheduleMode === "schedule" && dueAtLocal) {
        body.dueAt = new Date(dueAtLocal).toISOString();
      }
      if (saveToDraft) body.saveToDraft = true;

      const res = await fetch("/api/buffer/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const resBody = await res.json();
      if (!res.ok) throw new Error(resBody.error ?? "failed to create post");

      setText("");
      setImageUrl("");
      setAltText("");
      setScheduleMode("queue");
      setDueAtLocal("");
      setSaveToDraft(false);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to create post");
    } finally {
      setPosting(false);
    }
  }, [
    channelId,
    text,
    imageUrl,
    altText,
    instagramType,
    scheduleMode,
    dueAtLocal,
    saveToDraft,
    selectedChannel,
    loadAll,
  ]);

  const retry = useCallback(
    async (id: string) => {
      setActioningId(id);
      setError(null);
      try {
        const res = await fetch(`/api/buffer/posts/${id}?action=retry`, { method: "POST" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "failed to retry post");
        await loadAll();
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed to retry post");
      } finally {
        setActioningId(null);
      }
    },
    [loadAll],
  );

  const remove = useCallback(
    async (id: string) => {
      setActioningId(id);
      setError(null);
      try {
        const res = await fetch(`/api/buffer/posts/${id}`, { method: "DELETE" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "failed to delete post");
        await loadAll();
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed to delete post");
      } finally {
        setActioningId(null);
      }
    },
    [loadAll],
  );

  const queued = posts.filter((p) => p.status !== "sent" && p.status !== "error");
  const sent = posts.filter((p) => p.status === "sent");
  const errored = posts.filter((p) => p.status === "error");

  return (
    <section className="w-full">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">
          Buffer <span className="text-neutral-500">· Publishing</span>
        </h2>
        <p className="mt-1 text-sm text-neutral-400">
          Compose, queue, and track posts to your connected channels.
        </p>
      </header>

      {notConfigured && (
        <div className="mt-4 rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-300 ring-1 ring-amber-500/30">
          Buffer isn&apos;t connected yet. Generate a personal access token at{" "}
          <a
            href="https://publish.buffer.com/settings/api"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            publish.buffer.com/settings/api
          </a>{" "}
          and set <code className="rounded bg-neutral-800 px-1">BUFFER_ACCESS_TOKEN</code> in{" "}
          <code className="rounded bg-neutral-800 px-1">.env.local</code>, then restart the dev
          server.
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/30">
          {error}
        </div>
      )}

      {!notConfigured && (
        <>
          <div ref={composerRef} className="mt-4 rounded-lg bg-neutral-900 p-4 ring-1 ring-neutral-800">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className="rounded-md bg-neutral-800 px-3 py-2 text-sm ring-1 ring-neutral-700"
              >
                {channels.length === 0 && <option value="">No channels</option>}
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName ?? c.name} ({c.service})
                  </option>
                ))}
              </select>

              {selectedChannel?.service === "instagram" && (
                <select
                  value={instagramType}
                  onChange={(e) => setInstagramType(e.target.value as InstagramType)}
                  className="rounded-md bg-neutral-800 px-3 py-2 text-sm ring-1 ring-neutral-700"
                >
                  {INSTAGRAM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              )}

              <select
                value={scheduleMode}
                onChange={(e) => setScheduleMode(e.target.value as ScheduleMode)}
                className="rounded-md bg-neutral-800 px-3 py-2 text-sm ring-1 ring-neutral-700"
              >
                <option value="queue">Add to queue</option>
                <option value="now">Share now</option>
                <option value="schedule">Schedule for…</option>
              </select>

              {scheduleMode === "schedule" && (
                <input
                  type="datetime-local"
                  value={dueAtLocal}
                  onChange={(e) => setDueAtLocal(e.target.value)}
                  className="rounded-md bg-neutral-800 px-3 py-2 text-sm ring-1 ring-neutral-700"
                />
              )}
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What do you want to share?"
              rows={4}
              className="mt-3 w-full rounded-md bg-neutral-800 px-3 py-2 text-sm ring-1 ring-neutral-700 placeholder:text-neutral-600"
            />

            <div className="mt-3 flex flex-wrap gap-3">
              <input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder={
                  selectedChannel?.service === "instagram"
                    ? "Image URL (required for Instagram)"
                    : "Image URL (optional)"
                }
                className="min-w-64 flex-1 rounded-md bg-neutral-800 px-3 py-2 text-sm ring-1 ring-neutral-700 placeholder:text-neutral-600"
              />
              <input
                value={altText}
                onChange={(e) => setAltText(e.target.value)}
                placeholder="Alt text (optional)"
                className="min-w-48 flex-1 rounded-md bg-neutral-800 px-3 py-2 text-sm ring-1 ring-neutral-700 placeholder:text-neutral-600"
              />
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-neutral-400">
                <input
                  type="checkbox"
                  checked={saveToDraft}
                  onChange={(e) => setSaveToDraft(e.target.checked)}
                  className="rounded"
                />
                Save as draft for review
              </label>
              <button
                onClick={publish}
                disabled={posting || channels.length === 0}
                className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-400 disabled:opacity-50"
              >
                {posting ? "Publishing…" : "Publish"}
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Queue <span className="text-neutral-600">({queued.length})</span>
              </h3>
              <ul className="space-y-2">
                {queued.map((p) => (
                  <li key={p.id} className="rounded-lg bg-neutral-900 px-3 py-2.5 ring-1 ring-neutral-800">
                    {p.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.imageUrl}
                        alt=""
                        className="mb-2 h-32 w-full rounded-md object-cover"
                      />
                    )}
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-3 text-sm text-neutral-100">{p.text}</p>
                      <Chip tone={statusTone(p.status)}>{p.status}</Chip>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
                      <span>{p.dueAt ?? "—"}</span>
                      <button
                        onClick={() => remove(p.id)}
                        disabled={actioningId === p.id}
                        className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
                {queued.length === 0 && <li className="text-sm text-neutral-500">Nothing queued.</li>}
              </ul>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Sent <span className="text-neutral-600">({sent.length})</span>
              </h3>
              <ul className="space-y-2">
                {sent.map((p) => (
                  <li key={p.id} className="rounded-lg bg-neutral-900 px-3 py-2.5 ring-1 ring-neutral-800">
                    {p.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.imageUrl}
                        alt=""
                        className="mb-2 h-32 w-full rounded-md object-cover"
                      />
                    )}
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-3 text-sm text-neutral-100">{p.text}</p>
                      <Chip tone={statusTone(p.status)}>{p.status}</Chip>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
                      <span>{p.sentAt ?? "—"}</span>
                      <button
                        onClick={() => remove(p.id)}
                        disabled={actioningId === p.id}
                        className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
                {sent.length === 0 && <li className="text-sm text-neutral-500">Nothing sent yet.</li>}
              </ul>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Errors <span className="text-neutral-600">({errored.length})</span>
              </h3>
              <ul className="space-y-2">
                {errored.map((p) => (
                  <li key={p.id} className="rounded-lg bg-neutral-900 px-3 py-2.5 ring-1 ring-neutral-800">
                    {p.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.imageUrl}
                        alt=""
                        className="mb-2 h-32 w-full rounded-md object-cover"
                      />
                    )}
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-3 text-sm text-neutral-100">{p.text}</p>
                      <Chip tone={statusTone(p.status)}>{p.status}</Chip>
                    </div>
                    {p.error && <p className="mt-1 text-xs text-rose-300">{p.error}</p>}
                    <div className="mt-2 flex items-center justify-end gap-2 text-xs">
                      <button
                        onClick={() => retry(p.id)}
                        disabled={actioningId === p.id}
                        className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
                      >
                        Retry
                      </button>
                      <button
                        onClick={() => remove(p.id)}
                        disabled={actioningId === p.id}
                        className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
                {errored.length === 0 && <li className="text-sm text-neutral-500">No errors.</li>}
              </ul>
            </div>
          </div>

          {loading && <p className="mt-4 text-xs text-neutral-500">Loading…</p>}
        </>
      )}
    </section>
  );
}
