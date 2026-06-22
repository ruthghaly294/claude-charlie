import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { PROMPT_KEYS, PROMPT_DEFAULTS, loadPromptOverrides, savePromptOverride, clearPromptOverride, type PromptKey } from "@/publishing/prompts";

function isPromptKey(v: unknown): v is PromptKey {
  return typeof v === "string" && (PROMPT_KEYS as readonly string[]).includes(v);
}

/** GET /api/prompts → every prompt key with its default, override (if any), and effective value. */
export async function GET(): Promise<NextResponse> {
  const db = getDb();
  const overrides = loadPromptOverrides(db);
  const prompts = PROMPT_KEYS.map((key) => ({
    ...PROMPT_DEFAULTS[key],
    override: overrides[key] ?? null,
    value: overrides[key] ?? PROMPT_DEFAULTS[key].template,
  }));
  return NextResponse.json({ prompts });
}

/**
 * POST /api/prompts — body { key, value } upserts an override;
 * body { key, reset: true } clears it (reverting to the built-in default).
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: { key?: unknown; value?: unknown; reset?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!isPromptKey(body.key)) {
    return NextResponse.json({ error: "key must be one of: " + PROMPT_KEYS.join(", ") }, { status: 400 });
  }

  const db = getDb();
  if (body.reset === true) {
    clearPromptOverride(db, body.key);
    return NextResponse.json({ ok: true, key: body.key, value: PROMPT_DEFAULTS[body.key].template });
  }

  if (typeof body.value !== "string" || !body.value.trim()) {
    return NextResponse.json({ error: "value is required" }, { status: 400 });
  }
  savePromptOverride(db, body.key, body.value, new Date().toISOString());
  return NextResponse.json({ ok: true, key: body.key, value: body.value });
}
