import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { PROMPT_KEYS, PROMPT_DEFAULTS, type PromptKey } from "@/publishing/prompts";
import {
  loadVariantCatalog,
  createPromptVariant,
  updatePromptVariant,
  deletePromptVariant,
  restorePromptVariants,
  DEFAULT_VARIANT_ID,
} from "@/publishing/promptVariants";

function isPromptKey(v: unknown): v is PromptKey {
  return typeof v === "string" && (PROMPT_KEYS as readonly string[]).includes(v);
}

function rowId(key: string, variantId: string): string {
  return `${key}:${variantId}`;
}

/** GET /api/prompts/variants → the per-stage catalog (default first) for the dropdowns + manager. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ stages: loadVariantCatalog(getDb()) });
}

/**
 * POST /api/prompts/variants
 *  - { key, label, template, description? } → create a custom variant
 *  - { restore: true }                      → re-add any missing built-ins
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: { key?: unknown; label?: unknown; template?: unknown; description?: unknown; restore?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const db = getDb();

  if (body.restore === true) {
    return NextResponse.json({ ok: true, added: restorePromptVariants(db) });
  }

  if (!isPromptKey(body.key)) {
    return NextResponse.json({ error: "key must be one of: " + PROMPT_KEYS.join(", ") }, { status: 400 });
  }
  if (typeof body.label !== "string" || !body.label.trim()) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }
  if (typeof body.template !== "string" || !body.template.trim()) {
    return NextResponse.json({ error: "template is required" }, { status: 400 });
  }
  const warning = placeholderWarning(body.key, body.template);
  const created = createPromptVariant(db, {
    key: body.key,
    label: body.label.trim(),
    description: typeof body.description === "string" ? body.description : "",
    template: body.template,
  });
  return NextResponse.json({ ok: true, ...created, warning });
}

/** PATCH /api/prompts/variants — { key, id, label?, description?, template? } updates a variant. */
export async function PATCH(req: Request): Promise<NextResponse> {
  let body: { key?: unknown; id?: unknown; label?: unknown; description?: unknown; template?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!isPromptKey(body.key)) {
    return NextResponse.json({ error: "valid key is required" }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id || body.id === DEFAULT_VARIANT_ID) {
    return NextResponse.json({ error: "a non-default variant id is required" }, { status: 400 });
  }
  if (body.template !== undefined && (typeof body.template !== "string" || !body.template.trim())) {
    return NextResponse.json({ error: "template cannot be empty" }, { status: 400 });
  }
  const warning =
    typeof body.template === "string" ? placeholderWarning(body.key, body.template) : undefined;
  const ok = updatePromptVariant(getDb(), rowId(body.key, body.id), {
    label: typeof body.label === "string" ? body.label : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    template: typeof body.template === "string" ? body.template : undefined,
  });
  if (!ok) return NextResponse.json({ error: "variant not found" }, { status: 404 });
  return NextResponse.json({ ok: true, warning });
}

/** DELETE /api/prompts/variants?key=…&id=… removes a variant (built-in or custom). */
export async function DELETE(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const id = url.searchParams.get("id");
  if (!isPromptKey(key)) return NextResponse.json({ error: "valid key is required" }, { status: 400 });
  if (!id || id === DEFAULT_VARIANT_ID) {
    return NextResponse.json({ error: "a non-default variant id is required" }, { status: 400 });
  }
  const ok = deletePromptVariant(getDb(), rowId(key, id));
  if (!ok) return NextResponse.json({ error: "variant not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Non-fatal heads-up if an edit drops a placeholder the stage needs (e.g. {topic}). */
function placeholderWarning(key: PromptKey, template: string): string | undefined {
  const present = new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!));
  const missing = PROMPT_DEFAULTS[key].placeholders.filter((ph) => !present.has(ph));
  return missing.length > 0 ? `missing placeholders: ${missing.map((p) => `{${p}}`).join(", ")}` : undefined;
}
