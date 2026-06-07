import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCommandCenter } from "@/discovery/commandCenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(getCommandCenter(getDb()));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
