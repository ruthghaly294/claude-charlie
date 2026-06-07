import { basename, join } from "node:path";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { queryProducts } from "@/discovery/loopQuery";
import { exportAll } from "@/discovery/exporters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  try {
    const db = getDb();
    const products = queryProducts(db, 200);
    const dir = join(process.cwd(), "products");
    const paths = exportAll(products, dir);
    return NextResponse.json({
      exported: paths.length,
      dir,
      files: paths.map((p) => basename(p)),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "export failed" },
      { status: 500 },
    );
  }
}
