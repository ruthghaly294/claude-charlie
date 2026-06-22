import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { decisions } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manually reopen a "done"/"expired"/"reopened" decision so EXECUTE picks it
 * up again: resets `status` to "open" and restarts its ttl clock
 * (`createdAt`/`updatedAt` -> now, `expiresAt` cleared), with an audit note
 * appended to `rationale`.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const action = new URL(req.url).searchParams.get("action");
  if (action !== "reopen") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  try {
    const { id } = await params;
    const db = getDb();
    const decision = db.select().from(decisions).where(eq(decisions.id, id)).get();
    if (!decision) {
      return NextResponse.json({ error: "decision not found" }, { status: 404 });
    }
    if (decision.status === "open") {
      return NextResponse.json({ error: "decision is already open" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const rationale = `${decision.rationale}\n\n[reopened ${now}]: manually reopened by operator`;
    db.update(decisions)
      .set({ status: "open", createdAt: now, updatedAt: now, expiresAt: null, rationale })
      .where(eq(decisions.id, id))
      .run();

    const row = db.select().from(decisions).where(eq(decisions.id, id)).get();
    return NextResponse.json({ row });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to reopen decision" },
      { status: 500 },
    );
  }
}
