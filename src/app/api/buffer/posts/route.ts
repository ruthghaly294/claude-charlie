import { NextResponse } from "next/server";
import { z } from "zod";
import { createBufferClient, resolveOrgId, type BufferPostStatus, type ComposeInput } from "@/publishing/bufferClient";
import { getDb } from "@/db/client";
import { publishedPosts } from "@/db/schema";
import { PLATFORMS } from "@/publishing/postGenerator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["draft", "needs_approval", "scheduled", "sending", "sent", "error"] as const;

const composeSchema = z.object({
  channelId: z.string().min(1),
  text: z.string().min(1),
  imageUrl: z.string().url().optional(),
  altText: z.string().optional(),
  dueAt: z.string().optional(),
  shareNow: z.boolean().optional(),
  instagramType: z.enum(["post", "reel", "story"]).optional(),
  saveToDraft: z.boolean().optional(),
  // Optional provenance — when topic/itemUrl/itemTitle/platform are all
  // present, the created post is recorded in published_posts for dedup
  // (research/dedup.ts) and performance feedback (publishing/postFeedback.ts).
  topic: z.string().optional(),
  itemUrl: z.string().url().optional(),
  itemTitle: z.string().optional(),
  platform: z.enum(PLATFORMS).optional(),
  keyword: z.string().optional(),
});

export async function GET(req: Request): Promise<NextResponse> {
  const client = createBufferClient(process.env);
  if (!client.configured) {
    return NextResponse.json({ error: "BUFFER_ACCESS_TOKEN not configured" }, { status: 503 });
  }

  const statusParam = new URL(req.url).searchParams.get("status");
  let status: BufferPostStatus[] | undefined;
  if (statusParam) {
    const parsed = z.array(z.enum(STATUSES)).safeParse(statusParam.split(",").map((s) => s.trim()));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid status filter" }, { status: 400 });
    }
    status = parsed.data;
  }

  try {
    const orgId = await resolveOrgId(client);
    const rows = await client.listPosts(orgId, status ? { status } : undefined);
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to load posts" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const client = createBufferClient(process.env);
  if (!client.configured) {
    return NextResponse.json({ error: "BUFFER_ACCESS_TOKEN not configured" }, { status: 503 });
  }

  const parsed = composeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  try {
    const orgId = await resolveOrgId(client);
    const channels = await client.listChannels(orgId);
    const channel = channels.find((c) => c.id === input.channelId);
    if (!channel) {
      return NextResponse.json({ error: "unknown channel" }, { status: 400 });
    }
    if (channel.service === "instagram" && !input.imageUrl) {
      return NextResponse.json({ error: "Instagram posts require an image" }, { status: 400 });
    }

    const composeInput: ComposeInput = {
      channelId: input.channelId,
      text: input.text,
      imageUrl: input.imageUrl,
      altText: input.altText,
      dueAt: input.dueAt,
      shareNow: input.shareNow,
      instagramType:
        channel.service === "instagram" ? input.instagramType ?? "post" : input.instagramType,
      saveToDraft: input.saveToDraft,
    };
    const post = await client.createPost(composeInput);

    if (input.topic && input.itemUrl && input.itemTitle && input.platform) {
      getDb()
        .insert(publishedPosts)
        .values({
          id: `post:${post.id}`,
          bufferPostId: post.id,
          channelId: input.channelId,
          platform: input.platform,
          topic: input.topic,
          itemUrl: input.itemUrl,
          itemTitle: input.itemTitle,
          keyword: input.keyword ?? null,
          text: input.text,
          status: post.status,
          createdAt: new Date().toISOString(),
        })
        .run();
    }

    return NextResponse.json({ post }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to create post" },
      { status: 500 },
    );
  }
}
