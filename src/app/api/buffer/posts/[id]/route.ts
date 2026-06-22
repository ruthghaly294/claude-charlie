import { NextResponse } from "next/server";
import { createBufferClient } from "@/publishing/bufferClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const client = createBufferClient(process.env);
  if (!client.configured) {
    return NextResponse.json({ error: "BUFFER_ACCESS_TOKEN not configured" }, { status: 503 });
  }

  try {
    const { id } = await params;
    const result = await client.deletePost(id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to delete post" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const client = createBufferClient(process.env);
  if (!client.configured) {
    return NextResponse.json({ error: "BUFFER_ACCESS_TOKEN not configured" }, { status: 503 });
  }

  const action = new URL(req.url).searchParams.get("action");
  if (action !== "retry") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  try {
    const { id } = await params;
    const post = await client.retryPost(id);
    return NextResponse.json({ post });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to retry post" },
      { status: 500 },
    );
  }
}
