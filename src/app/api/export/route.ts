import { basename, join } from "node:path";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { loadConfig } from "@/discovery/config";
import { queryProducts } from "@/discovery/loopQuery";
import { exportAll, createNotifyExporter } from "@/discovery/exporters";
import { buildNotifiers } from "@/notify/build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  try {
    const db = getDb();
    const products = queryProducts(db, 200);
    const dir = join(process.cwd(), "products");
    const paths = exportAll(products, dir);

    const config = loadConfig();
    const notifyExporter = createNotifyExporter(db, buildNotifiers(config.notify, process.env));
    let notified = 0;
    if (notifyExporter.configured) {
      for (const product of products) {
        await notifyExporter.export(product);
        notified++;
      }
    }

    return NextResponse.json({
      exported: paths.length,
      dir,
      files: paths.map((p) => basename(p)),
      notified,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "export failed" },
      { status: 500 },
    );
  }
}
