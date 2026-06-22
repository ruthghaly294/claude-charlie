import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { loadConfig } from "@/discovery/config";
import { UsageMeter } from "@/discovery/usage";
import { runSeoAudit } from "@/seo/audit";
import { getReasonerClient } from "@/seo/reasoner";
import { getSite, upsertSite } from "@/seo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  siteId: z.string().optional(),
  domain: z.string().optional(),
  competitors: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
});

/** Run an audit on demand (the dashboard "Run audit" button). */
export async function POST(req: Request): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (!parsed.data.siteId && !parsed.data.domain)) {
    return NextResponse.json({ error: "provide siteId or domain" }, { status: 400 });
  }
  try {
    const db = getDb();
    const config = loadConfig();
    const site = parsed.data.siteId
      ? getSite(db, parsed.data.siteId)
      : upsertSite(db, {
          domain: parsed.data.domain!,
          competitors: parsed.data.competitors,
          keywords: parsed.data.keywords,
        });
    if (!site) return NextResponse.json({ error: "site not found" }, { status: 404 });

    const summary = await runSeoAudit(db, site, {
      reasonerClient: getReasonerClient(process.env),
      meter: new UsageMeter(),
      env: process.env,
      autoResolveAfterRuns: config.seo.autoResolveAfterRuns,
    });
    return NextResponse.json({ summary });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "audit failed" },
      { status: 500 },
    );
  }
}
