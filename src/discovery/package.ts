import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  executions,
  products,
  type Execution,
  type NewProduct,
} from "@/db/schema";
import type { DecodeConfig, MonetizationFormat } from "./config";

export type PackageSummary = { productsWritten: number };

export type PackageOptions = { now?: () => string };

function stripMd(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").replace(/^>\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split prose into tweet-sized numbered chunks (≤ 270 chars), capped. */
export function toThread(title: string, body: string, max = 7): string {
  const sentences = stripMd(body)
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + " " + s).trim().length > 270) {
      if (cur) chunks.push(cur.trim());
      cur = s;
    } else {
      cur = `${cur} ${s}`.trim();
    }
    if (chunks.length >= max - 1) break;
  }
  if (cur && chunks.length < max - 1) chunks.push(cur.trim());
  const tweets = [`${title} 🧵`, ...chunks];
  return tweets.map((t, i) => `${i + 1}/ ${t}`).join("\n\n");
}

/** Crude price ladder for a paid download, by lane. */
function suggestedPrice(lane: string): number {
  if (lane === "product") return 29;
  if (lane === "strategic") return 49;
  return 9;
}

/** Pure transform: render one execution into one sellable format. */
export function formatProduct(
  format: MonetizationFormat,
  exec: Execution,
): { title: string; body: string; price: number } {
  switch (format) {
    case "newsletter":
      return {
        title: exec.title,
        price: 0,
        body: [
          `**Subject:** ${exec.title}`,
          "",
          exec.body,
          "",
          "---",
          "_Enjoyed this? Forward it, or subscribe for the next issue._",
        ].join("\n"),
      };
    case "download":
      return {
        title: exec.title,
        price: suggestedPrice(exec.lane),
        body: [
          `# ${exec.title}`,
          "",
          `**Suggested price:** $${suggestedPrice(exec.lane)}`,
          "",
          "## Listing summary",
          stripMd(exec.body).slice(0, 280),
          "",
          "## Full content",
          exec.body,
        ].join("\n"),
      };
    case "thread":
      return { title: exec.title, price: 0, body: toThread(exec.title, exec.body) };
    case "file":
    default:
      return { title: exec.title, price: 0, body: exec.body };
  }
}

/**
 * PACKAGE: turn every "ready" execution into the sellable formats the operator
 * chose (config.monetization). Idempotent: product ids are stable
 * (`product:<executionId>:<format>`), so re-runs update rather than duplicate.
 */
export function runPackage(
  db: DB,
  config: DecodeConfig,
  opts: PackageOptions = {},
): PackageSummary {
  const { now = () => new Date().toISOString() } = opts;
  const ready = db
    .select()
    .from(executions)
    .where(eq(executions.status, "ready"))
    .all();

  const createdAt = now();
  let productsWritten = 0;

  for (const exec of ready) {
    for (const format of config.monetization) {
      const { title, body, price } = formatProduct(format, exec);
      const product: NewProduct = {
        id: `product:${exec.id}:${format}`,
        executionId: exec.id,
        format,
        title,
        body,
        price,
        status: "draft",
        createdAt,
      };
      db.insert(products)
        .values(product)
        .onConflictDoUpdate({
          target: products.id,
          set: { title, body, price },
        })
        .run();
      productsWritten++;
    }
  }

  return { productsWritten };
}
