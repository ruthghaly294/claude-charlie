import { NextResponse } from "next/server";
import { z } from "zod";
import { getPostGenerator } from "@/publishing/postGenerator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const itemSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  snippet: z.string(),
  author: z.string().optional(),
  publishedAt: z.string().optional(),
  engagement: z.record(z.string(), z.number()),
});

const bodySchema = z.object({
  topic: z.string().trim().min(2).max(200),
  item: itemSchema,
});

export async function POST(req: Request): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const generator = getPostGenerator({}, process.env);
    const post = await generator.generatePost(parsed.data);
    return NextResponse.json({ draft: { text: post.text } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to generate post" },
      { status: 500 },
    );
  }
}
