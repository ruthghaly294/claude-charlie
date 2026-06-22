import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any */
let GET: () => Promise<Response>;
let POST: (req: Request) => Promise<Response>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "prompts-api-"));
  process.env.DECODE_DB_PATH = join(dir, "t.db");

  const route = await import("./route");
  GET = route.GET as any;
  POST = route.POST as any;
});

function postReq(body: unknown): Request {
  return new Request("http://localhost/api/prompts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/prompts", () => {
  it("lists every prompt key with override=null and value=default when nothing is overridden", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompts.length).toBeGreaterThan(0);
    const judge = body.prompts.find((p: any) => p.key === "judge.system");
    expect(judge.override).toBeNull();
    expect(judge.value).toBe(judge.template);
  });
});

describe("POST /api/prompts", () => {
  it("rejects an unknown key", async () => {
    const res = await POST(postReq({ key: "not.a.real.key", value: "x" }));
    expect(res.status).toBe(400);
  });

  it("rejects a missing/blank value when not resetting", async () => {
    const res = await POST(postReq({ key: "judge.system", value: "   " }));
    expect(res.status).toBe(400);
  });

  it("saves an override, and GET reflects it", async () => {
    const res = await POST(postReq({ key: "judge.system", value: "custom judge prompt" }));
    expect(res.status).toBe(200);

    const list = await (await GET()).json();
    const judge = list.prompts.find((p: any) => p.key === "judge.system");
    expect(judge.override).toBe("custom judge prompt");
    expect(judge.value).toBe("custom judge prompt");
  });

  it("reset clears the override, reverting to the built-in default", async () => {
    await POST(postReq({ key: "judge.system", value: "custom judge prompt" }));
    const res = await POST(postReq({ key: "judge.system", reset: true }));
    expect(res.status).toBe(200);

    const list = await (await GET()).json();
    const judge = list.prompts.find((p: any) => p.key === "judge.system");
    expect(judge.override).toBeNull();
    expect(judge.value).toBe(judge.template);
  });
});
