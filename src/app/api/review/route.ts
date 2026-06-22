import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { generatedVideos } from "@/db/schema";
import { loadConfig } from "@/discovery/config";
import { createBufferClient } from "@/publishing/bufferClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Brief = { caption?: string; hashtags?: string[]; hook?: string };

function postText(brief: Brief | null): string {
  const caption = brief?.caption?.trim() || brief?.hook?.trim() || "";
  const tags = (brief?.hashtags ?? [])
    .map((h) => `#${String(h).trim().replace(/^#+/, "")}`)
    .filter((t) => t.length > 1);
  return tags.length ? `${caption}\n\n${tags.join(" ")}` : caption;
}

/** List the most recent generated videos for review (newest first). */
export async function GET(): Promise<NextResponse> {
  const db = getDb();
  const rows = db.select().from(generatedVideos).orderBy(desc(generatedVideos.createdAt)).limit(30).all();
  const items = rows.map((r) => {
    const brief = (r.brief ?? null) as Brief | null;
    return {
      id: r.id,
      topic: r.topic,
      status: r.status,
      format: r.format,
      coverImageUrl: r.coverImageUrl,
      videoUrl: r.videoUrl,
      slideUrls: r.slideUrls ?? null,
      caption: postText(brief),
      soundMood: r.soundMood,
      viralityScore: r.viralityScore,
      bufferPostId: r.bufferPostId,
      createdAt: r.createdAt,
    };
  });
  return NextResponse.json({ items });
}

const ACTIONS = ["queue", "schedule", "publish", "status", "delete"] as const;
type Action = (typeof ACTIONS)[number];

/** Map Buffer's post status to our DB status + a verdict the UI can render. */
function mapBufferStatus(s: string): {
  dbStatus: "published" | "publishing" | "queued" | "error";
  published: boolean;
  pending: boolean;
} {
  if (s === "sent") return { dbStatus: "published", published: true, pending: false };
  if (s === "error") return { dbStatus: "error", published: false, pending: false };
  if (s === "scheduled") return { dbStatus: "queued", published: false, pending: false };
  // sending / needs_approval / draft / anything else → still in flight
  return { dbStatus: "publishing", published: false, pending: true };
}

/** Approve→queue, schedule, publish-now, re-check status, or delete a generated video's Buffer post. */
export async function POST(req: Request): Promise<NextResponse> {
  let body: { id?: unknown; action?: unknown; dueAt?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const action = body.action as Action;
  const dueAt = typeof body.dueAt === "string" ? body.dueAt : undefined;
  if (!id || !ACTIONS.includes(action)) {
    return NextResponse.json({ error: "id and a valid action are required" }, { status: 400 });
  }

  const db = getDb();
  const row = db.select().from(generatedVideos).where(eq(generatedVideos.id, id)).get();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const config = loadConfig();
  const client = createBufferClient(process.env);
  if (!client.configured) {
    return NextResponse.json({ error: "Buffer is not configured (set BUFFER_ACCESS_TOKEN)" }, { status: 400 });
  }

  try {
    if (action === "delete") {
      if (row.bufferPostId) await client.deletePost(row.bufferPostId);
      db.update(generatedVideos).set({ status: "rejected" }).where(eq(generatedVideos.id, id)).run();
      return NextResponse.json({ ok: true, status: "rejected" });
    }

    if (!row.bufferPostId) {
      return NextResponse.json({ error: "no Buffer post to act on for this item" }, { status: 400 });
    }

    // Re-check the live Buffer status of an already-published post (UI polling).
    if (action === "status") {
      const post = await client.getPost(row.bufferPostId);
      const m = mapBufferStatus(post.status);
      db.update(generatedVideos).set({ status: m.dbStatus }).where(eq(generatedVideos.id, id)).run();
      return NextResponse.json({
        ok: true,
        status: m.dbStatus,
        published: m.published,
        pending: m.pending,
        bufferStatus: post.status,
        error: post.error,
        sentAt: post.sentAt,
      });
    }

    const channelId = config.publishing.channelsByPlatform.instagram;
    if (!channelId) {
      return NextResponse.json({ error: "no Instagram channel configured" }, { status: 400 });
    }

    const isCarousel = row.format === "qotd-carousel";
    const commonEdit = isCarousel
      ? {
          id: row.bufferPostId,
          channelId,
          text: postText((row.brief ?? null) as Brief | null),
          imageUrls: row.slideUrls ?? [],
          instagramType: "post" as const, // multi-image post = Instagram carousel
          saveToDraft: false,
        }
      : {
          id: row.bufferPostId,
          channelId,
          text: postText((row.brief ?? null) as Brief | null),
          videoUrl: row.videoUrl,
          thumbnailUrl: row.coverImageUrl ?? undefined,
          instagramType: "reel" as const,
          saveToDraft: false,
        };

    // Publish immediately (Buffer "shareNow"), then read back the confirmed status.
    // Instagram shareNow can return an error envelope yet still send, so the
    // post's actual status (not the mutation response) is the source of truth.
    if (action === "publish") {
      let editError: string | null = null;
      try {
        await client.editPost({ ...commonEdit, shareNow: true });
      } catch (e) {
        editError = e instanceof Error ? e.message : String(e);
      }
      const post = await client.getPost(row.bufferPostId);
      const m = mapBufferStatus(post.status);
      db.update(generatedVideos).set({ status: m.dbStatus }).where(eq(generatedVideos.id, id)).run();
      return NextResponse.json({
        ok: true,
        status: m.dbStatus,
        published: m.published,
        pending: m.pending,
        bufferStatus: post.status,
        // Only surface the edit error if the post did NOT actually publish.
        error: post.error ?? (m.published || m.pending ? null : editError),
        sentAt: post.sentAt,
      });
    }

    // queue / schedule: move out of draft into Buffer's queue (publishes at a slot).
    await client.editPost({ ...commonEdit, dueAt: action === "schedule" ? dueAt : undefined });
    db.update(generatedVideos).set({ status: "queued" }).where(eq(generatedVideos.id, id)).run();
    return NextResponse.json({ ok: true, status: "queued", scheduledFor: action === "schedule" ? dueAt : null });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
