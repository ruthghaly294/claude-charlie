import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { importListingEnriched } from "@/property/listings";
import { parsePropertyPalEmail } from "@/property/emailParse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ html: z.string().min(1) });

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "expected { html }" }, { status: 400 });
    }
    const db = getDb();
    const listings = parsePropertyPalEmail(parsed.data.html);
    const saved = [];
    for (const l of listings) saved.push(await importListingEnriched(db, l));
    return NextResponse.json({
      parsed: listings.length,
      imported: saved.length,
      withValue: saved.filter((s) => s.fairValue != null).length,
      listings: saved,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "email import failed" },
      { status: 500 },
    );
  }
}
