import { NextResponse } from "next/server";
import { loadConfig } from "@/discovery/config";
import { createHiggsfieldClient } from "@/publishing/higgsfieldClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const config = loadConfig();
  return NextResponse.json({
    channelsByPlatform: config.publishing.channelsByPlatform,
    higgsfieldConfigured: createHiggsfieldClient(process.env).configured,
  });
}
