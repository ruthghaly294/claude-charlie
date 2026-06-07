import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Product } from "@/db/schema";
import { slugify } from "./scoring";

/**
 * Distribution adapter: takes a product and ships it somewhere, returning where
 * it went. File export is implemented; hosted channels (Gumroad, Substack,
 * email) are stubs behind the same interface — wire them when keys exist.
 */
export interface Exporter {
  name: string;
  configured: boolean;
  export(product: Product): Promise<{ location: string }>;
}

/** Write one product to a Markdown file under `dir`; returns the file path. */
export function exportProductToFile(product: Product, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const base = slugify(product.title) || product.id.replace(/[^a-z0-9]+/gi, "-");
  const path = join(dir, `${product.format}-${base}.md`);
  const front = [
    "---",
    `format: ${product.format}`,
    `title: ${JSON.stringify(product.title)}`,
    `price: ${product.price}`,
    "---",
    "",
  ].join("\n");
  writeFileSync(path, front + product.body);
  return path;
}

/** Export every product to `dir`; returns the written file paths. */
export function exportAll(products: Product[], dir: string): string[] {
  return products.map((p) => exportProductToFile(p, dir));
}
