import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { listSites, upsertSite } from "@/seo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
  domain: z.string().min(1),
  competitors: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  maxPages: z.number().optional(),
});

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ sites: listSites(getDb()) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid site payload" }, { status: 400 });
  }
  try {
    const site = upsertSite(getDb(), parsed.data);
    return NextResponse.json({ site });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
