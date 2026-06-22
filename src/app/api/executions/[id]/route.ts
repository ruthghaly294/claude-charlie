import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { executions } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve a "ready" content-queue execution: "publish" marks it published
 * (it was queued to Buffer), "dismiss" sends it back to "draft" so it drops
 * out of the queue without being posted.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const action = new URL(req.url).searchParams.get("action");
  if (action !== "publish" && action !== "dismiss") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  try {
    const { id } = await params;
    const db = getDb();
    const execution = db.select().from(executions).where(eq(executions.id, id)).get();
    if (!execution) {
      return NextResponse.json({ error: "execution not found" }, { status: 404 });
    }
    if (execution.status !== "ready") {
      return NextResponse.json(
        { error: `execution is not ready (status: ${execution.status})` },
        { status: 400 },
      );
    }

    const status = action === "publish" ? "published" : "draft";
    db.update(executions).set({ status }).where(eq(executions.id, id)).run();

    const row = db.select().from(executions).where(eq(executions.id, id)).get();
    return NextResponse.json({ row });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to update execution" },
      { status: 500 },
    );
  }
}
