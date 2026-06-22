import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  latestAudit,
  latestRankings,
  openRecommendations,
  setRecommendationStatus,
} from "@/seo/store";
import { providerStatuses } from "@/seo/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const db = getDb();
    const siteId = new URL(req.url).searchParams.get("siteId");
    if (!siteId) return NextResponse.json({ error: "siteId required" }, { status: 400 });
    const audit = latestAudit(db, siteId);
    return NextResponse.json({
      audit: audit ?? null,
      recommendations: openRecommendations(db, siteId, audit?.id),
      rankings: latestRankings(db, siteId),
      providers: providerStatuses({ env: process.env }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}

const patchSchema = z.object({
  id: z.string(),
  status: z.enum(["open", "done", "dismissed", "reopened"]),
});

export async function PATCH(req: Request): Promise<NextResponse> {
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  try {
    setRecommendationStatus(getDb(), parsed.data.id, parsed.data.status);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
