import { NextResponse } from "next/server";
import { z } from "zod";
import { getPostGenerator, PLATFORMS, MAX_AMALGAMATION_ITEMS } from "@/publishing/postGenerator";
import { validatePost } from "@/publishing/validate";
import { loadConfig } from "@/discovery/config";

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
  items: z.array(itemSchema).min(1).max(MAX_AMALGAMATION_ITEMS),
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
    const config = loadConfig();
    const generator = getPostGenerator(
      {
        businessName: config.businessName,
        businessDescription: config.businessDescription,
        profile: config.profile,
        voice: config.profile.voice,
      },
      process.env,
    );
    const { variants, assetPrompt } = await generator.generatePosts(parsed.data);
    const drafts = Object.fromEntries(
      PLATFORMS.map((p) => [
        p,
        {
          text: variants[p].text,
          hashtags: variants[p].hashtags,
          issues: validatePost(p, variants[p], { url: parsed.data.items[0]!.url, hasImage: false }),
        },
      ]),
    );
    return NextResponse.json({ drafts, assetPrompt });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to generate post" },
      { status: 500 },
    );
  }
}
