import { NextResponse } from "next/server";
import { createBufferClient, resolveOrgId } from "@/publishing/bufferClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const client = createBufferClient(process.env);
  if (!client.configured) {
    return NextResponse.json({ error: "BUFFER_ACCESS_TOKEN not configured" }, { status: 503 });
  }

  try {
    const orgId = await resolveOrgId(client);
    const rows = await client.listChannels(orgId);
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to load channels" },
      { status: 500 },
    );
  }
}
