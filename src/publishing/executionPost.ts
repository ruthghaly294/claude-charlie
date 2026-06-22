import { PLATFORMS, type GeneratedPost, type Platform } from "./postGenerator";

const X_MAX_LENGTH = 280;
const MAX_HASHTAGS = 5;
const MIN_HASHTAG_WORD_LENGTH = 3;

/** Shorten text to at most maxLength characters, appending an ellipsis if cut. */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return "…".slice(0, Math.max(maxLength, 0));
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Significant words from the title, falling back to the lane so instagram always gets ≥1 tag. */
function hashtagsFromTitle(title: string, lane: string, max: number): string[] {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > MIN_HASHTAG_WORD_LENGTH);
  const tags = [...new Set(words)].slice(0, max);
  if (tags.length === 0) {
    const fallback = lane.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (fallback) tags.push(fallback);
  }
  return tags;
}

/**
 * Reformat an already-drafted, quality-scored DECODE execution into
 * per-platform post text — no LLM call (the content is already written) and
 * no source URL (the body is original content, not a link to share).
 */
export function draftsFromExecution(exec: {
  title: string;
  body: string;
  lane: string;
}): Record<Platform, GeneratedPost> {
  const text = `${exec.title}\n\n${exec.body.trim()}`;
  const igTags = hashtagsFromTitle(exec.title, exec.lane, MAX_HASHTAGS);
  const igText = igTags.length ? `${text}\n\n${igTags.map((t) => `#${t}`).join(" ")}` : text;

  const variants = {} as Record<Platform, GeneratedPost>;
  for (const p of PLATFORMS) {
    variants[p] =
      p === "instagram"
        ? { text: igText, hashtags: igTags }
        : { text: p === "x" ? truncate(text, X_MAX_LENGTH) : text, hashtags: [] };
  }
  return variants;
}

/** A Higgsfield cover-image prompt synthesized from the execution's own title + body. */
export function assetPromptFromExecution(exec: { title: string; body: string }): string {
  const hook = exec.body.trim().slice(0, 200);
  return `A clean, modern social-media cover image about "${exec.title}", inspired by: ${hook}. Vibrant colors, minimal-to-no text.`;
}
