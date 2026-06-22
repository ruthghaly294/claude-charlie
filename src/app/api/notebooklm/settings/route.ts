import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { loadConfig } from "@/discovery/config";
import { notebookLmConfigured } from "@/research/notebookLm";
import { resolveNotebookLmSettings, saveNotebookLmSettings } from "@/publishing/notebookInsight";

/** GET /api/notebooklm/settings → effective settings + whether cookies are imported. */
export async function GET(): Promise<NextResponse> {
  const db = getDb();
  const settings = resolveNotebookLmSettings(db, loadConfig());
  return NextResponse.json({
    enabled: settings.enabled,
    mode: settings.mode,
    notebookId: settings.notebookId,
    cookiesPresent: notebookLmConfigured(),
  });
}

/** POST /api/notebooklm/settings — body { enabled, mode, notebookId } upserts the toggle/mode/notebook. */
export async function POST(req: Request): Promise<NextResponse> {
  let body: { enabled?: unknown; mode?: unknown; notebookId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  if (body.mode !== "discovery" && body.mode !== "existing") {
    return NextResponse.json({ error: 'mode must be "discovery" or "existing"' }, { status: 400 });
  }
  if (typeof body.notebookId !== "string") {
    return NextResponse.json({ error: "notebookId must be a string" }, { status: 400 });
  }
  if (body.mode === "existing" && body.enabled && !body.notebookId.trim()) {
    return NextResponse.json({ error: "notebookId is required for existing mode" }, { status: 400 });
  }

  const db = getDb();
  saveNotebookLmSettings(
    db,
    { enabled: body.enabled, mode: body.mode, notebookId: body.notebookId.trim() },
    new Date().toISOString(),
  );
  return NextResponse.json({ ok: true });
}
