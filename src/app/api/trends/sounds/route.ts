import { NextResponse, type NextRequest } from "next/server";
import { loadConfig } from "@/discovery/config";
import { getTrendingSounds } from "@/research/trendingSounds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const topic = req.nextUrl.searchParams.get("topic") ?? undefined;
    const config = loadConfig();
    const result = await getTrendingSounds({
      topic,
      connectorConfig: config.sources["tiktok_sounds"],
      musicProvider: config.trendImitation.music.provider,
      env: process.env,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal error" },
      { status: 500 },
    );
  }
}
