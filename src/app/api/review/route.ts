import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { generatedVideos } from "@/db/schema";
import { loadConfig } from "@/discovery/config";
import { createBufferClient, resolveOrgId } from "@/publishing/bufferClient";

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

type ReviewItem = {
  id: string;
  topic: string;
  status: string;
  format: string;
  coverImageUrl: string | null;
  videoUrl: string;
  slideUrls: string[] | null;
  caption: string;
  soundMood: string | null;
  viralityScore: number | null;
  bufferPostId: string | null;
  createdAt: string;
};

/** Map a live Buffer post status onto the review queue's status vocabulary. */
function bufferStatusToReview(s: string): string {
  if (s === "sent") return "published";
  if (s === "error") return "error";
  if (s === "scheduled") return "queued";
  if (s === "sending") return "publishing";
  return "draft"; // draft | needs_approval
}

/**
 * Drafts that live ONLY on Buffer — e.g. created by the CI daily scheduler,
 * which writes its DB row to the runner's throwaway disk, never this machine.
 * Reading them straight from Buffer is what makes those drafts reviewable here.
 */
async function bufferDraftItems(): Promise<ReviewItem[]> {
  const client = createBufferClient(process.env);
  if (!client.configured) return [];
  const channelId = loadConfig().publishing.channelsByPlatform.instagram;
  try {
    const orgId = await resolveOrgId(client);
    const posts = await client.listPosts(orgId, {
      status: ["draft", "needs_approval", "scheduled", "sending"],
    });
    return posts
      .filter((p) => !channelId || p.channelId === channelId)
      .map((p) => {
        const isCarousel = p.imageUrls.length > 1;
        return {
          id: p.id,
          topic: isCarousel ? "QOTD daily draft" : "Buffer draft",
          status: bufferStatusToReview(p.status),
          format: isCarousel ? "qotd-carousel" : "trend-video",
          coverImageUrl: p.imageUrl,
          videoUrl: "",
          slideUrls: p.imageUrls.length ? p.imageUrls : null,
          caption: p.text,
          soundMood: null,
          viralityScore: null,
          bufferPostId: p.id,
          createdAt: p.dueAt ?? p.sentAt ?? "",
        };
      });
  } catch {
    // Buffer unreachable/throttled — fall back to local rows only, never 500 the page.
    return [];
  }
}

/** List drafts for review: Buffer drafts (CI + local) merged with local DB rows. */
export async function GET(): Promise<NextResponse> {
  const db = getDb();
  const rows = db.select().from(generatedVideos).orderBy(desc(generatedVideos.createdAt)).limit(30).all();
  const localItems: ReviewItem[] = rows.map((r) => {
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

  // A draft already tracked locally is shown from the local row; only surface
  // Buffer posts we have no local record of (the CI-created ones the user can't see).
  const localBufferIds = new Set(localItems.map((it) => it.bufferPostId).filter(Boolean));
  const bufferOnly = (await bufferDraftItems()).filter((it) => !localBufferIds.has(it.bufferPostId));

  return NextResponse.json({ items: [...bufferOnly, ...localItems] });
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

  const config = loadConfig();
  const client = createBufferClient(process.env);
  if (!client.configured) {
    return NextResponse.json({ error: "Buffer is not configured (set BUFFER_ACCESS_TOKEN)" }, { status: 400 });
  }

  const db = getDb();
  const row = db.select().from(generatedVideos).where(eq(generatedVideos.id, id)).get();

  // No local row? The id may be a Buffer-only draft (e.g. created by the CI
  // scheduler). Resolve it straight from Buffer so it's still actionable here.
  let bufferOnly: Awaited<ReturnType<typeof client.getPost>> | null = null;
  if (!row) {
    try {
      bufferOnly = await client.getPost(id);
    } catch {
      bufferOnly = null;
    }
    if (!bufferOnly) return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // DB write helper: a no-op for Buffer-only drafts (nothing local to update).
  type ReviewStatus =
    | "draft"
    | "scored"
    | "queued"
    | "publishing"
    | "published"
    | "rejected"
    | "generated"
    | "error";
  const setLocalStatus = (status: ReviewStatus) => {
    if (row) db.update(generatedVideos).set({ status }).where(eq(generatedVideos.id, id)).run();
  };

  try {
    if (action === "delete") {
      const bid = row?.bufferPostId ?? bufferOnly?.id ?? null;
      if (bid) await client.deletePost(bid);
      setLocalStatus("rejected");
      return NextResponse.json({ ok: true, status: "rejected" });
    }

    const bufferPostId = row?.bufferPostId ?? bufferOnly?.id ?? null;
    if (!bufferPostId) {
      return NextResponse.json({ error: "no Buffer post to act on for this item" }, { status: 400 });
    }

    // Re-check the live Buffer status of an already-published post (UI polling).
    if (action === "status") {
      const post = await client.getPost(bufferPostId);
      const m = mapBufferStatus(post.status);
      setLocalStatus(m.dbStatus);
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

    // Media + text come from the local row when we have one, otherwise from the
    // existing Buffer draft (whose assets/text are already attached on Buffer).
    const editText = row ? postText((row.brief ?? null) as Brief | null) : bufferOnly!.text;
    const editImages = row ? row.slideUrls ?? [] : bufferOnly!.imageUrls;
    const isCarousel = row ? row.format === "qotd-carousel" : editImages.length > 1;
    const commonEdit = isCarousel
      ? {
          id: bufferPostId,
          channelId,
          text: editText,
          imageUrls: editImages,
          instagramType: "post" as const, // multi-image post = Instagram carousel
          saveToDraft: false,
        }
      : {
          id: bufferPostId,
          channelId,
          text: editText,
          videoUrl: row?.videoUrl ?? "",
          thumbnailUrl: row?.coverImageUrl ?? bufferOnly?.imageUrl ?? undefined,
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
      const post = await client.getPost(bufferPostId);
      const m = mapBufferStatus(post.status);
      setLocalStatus(m.dbStatus);
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
    setLocalStatus("queued");
    return NextResponse.json({ ok: true, status: "queued", scheduledFor: action === "schedule" ? dueAt : null });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
