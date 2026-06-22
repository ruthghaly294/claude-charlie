import { spawn } from "node:child_process";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { checkAuth, notebookLmConfigured } from "@/research/notebookLm";

const SCRIPT = join(process.cwd(), "scripts", "refresh_notebooklm_auth.py");

/** GET /api/notebooklm/auth → whether cookies are imported and still authenticate. */
export async function GET(): Promise<NextResponse> {
  const cookiesPresent = notebookLmConfigured();
  const authValid = cookiesPresent ? await checkAuth() : false;
  return NextResponse.json({ cookiesPresent, authValid });
}

/**
 * POST /api/notebooklm/auth — body { cookies: <Cookie-Editor JSON, string or array> }.
 * Pipes the export to scripts/refresh_notebooklm_auth.py (stdin) which writes the
 * Playwright storage_state.json the CLI authenticates with. Cookies are never logged
 * or persisted by this route beyond what the converter writes to ~/.notebooklm.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: { cookies?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const cookies = body.cookies;
  const payload =
    typeof cookies === "string"
      ? cookies
      : Array.isArray(cookies)
        ? JSON.stringify(cookies)
        : null;
  if (!payload) {
    return NextResponse.json({ error: "cookies must be a Cookie-Editor JSON string or array" }, { status: 400 });
  }

  const python = process.env.NOTEBOOKLM_PYTHON ?? "python3";
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(python, [SCRIPT], { env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: stderr + String(err) }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(payload);
    child.stdin.end();
  });

  if (result.code !== 0) {
    return NextResponse.json(
      { error: "cookie import failed", detail: result.stderr.trim() || result.stdout.trim() },
      { status: 500 },
    );
  }

  // The converter warns about missing required cookies on stderr; surface it.
  const missingMatch = result.stderr.match(/missing cookies: (.+)/);
  const cookiesPresent = notebookLmConfigured();
  const authValid = cookiesPresent ? await checkAuth() : false;
  return NextResponse.json({
    ok: true,
    cookiesPresent,
    authValid,
    missing: missingMatch ? missingMatch[1]!.split(",").map((s) => s.trim()) : [],
    output: result.stdout.trim(),
  });
}
