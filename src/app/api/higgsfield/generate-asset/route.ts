import { NextResponse } from "next/server";
import { z } from "zod";
import { createHiggsfieldClient } from "@/publishing/higgsfieldClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
});

export async function POST(req: Request): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const client = createHiggsfieldClient(process.env);
  if (!client.configured) {
    return NextResponse.json(
      { error: "Higgsfield is not configured (run `higgsfield auth login` or set HIGGSFIELD_API_KEY)" },
      { status: 503 },
    );
  }

  try {
    const asset = await client.generateAsset(parsed.data.prompt);
    return NextResponse.json({ asset });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to generate asset" },
      { status: 500 },
    );
  }
}
