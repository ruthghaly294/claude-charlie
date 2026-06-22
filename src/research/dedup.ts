import { ne } from "drizzle-orm";
import type { DB } from "@/db/client";
import { publishedPosts } from "@/db/schema";

/**
 * Annotate each item with `alreadyPosted: true` when its `url` matches a
 * `published_posts` row whose status isn't "error" (an errored post never
 * went out, so its URL is fair game again).
 */
export function markAlreadyPosted<T extends { url: string }>(
  items: T[],
  db: DB,
): (T & { alreadyPosted: boolean })[] {
  const rows = db
    .select({ itemUrl: publishedPosts.itemUrl })
    .from(publishedPosts)
    .where(ne(publishedPosts.status, "error"))
    .all();

  const posted = new Set(rows.map((r) => r.itemUrl));
  return items.map((item) => ({ ...item, alreadyPosted: posted.has(item.url) }));
}
