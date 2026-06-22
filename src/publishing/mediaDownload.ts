import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";

/**
 * Resolve a media reference into something a CLI that only accepts a local path
 * or UUID can use. An http(s) URL is downloaded to a temp file (extension
 * preserved so the type can be auto-detected) and that path is returned; local
 * paths and UUIDs pass through unchanged. Shared by the Higgsfield image→video
 * start-image and the Virality Predictor video input.
 */
export async function resolveLocalMedia(
  ref: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!/^https?:\/\//i.test(ref)) return ref;
  const res = await fetchImpl(ref);
  if (!res.ok) throw new Error(`failed to download media (${res.status}): ${ref}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = extname(new URL(ref).pathname) || ".bin";
  const path = join(tmpdir(), `media-${createHash("sha1").update(ref).digest("hex").slice(0, 16)}${ext}`);
  writeFileSync(path, buf);
  return path;
}
