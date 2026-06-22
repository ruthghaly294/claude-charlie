import { X_MAX_LENGTH, type Platform } from "./postGenerator";

export type ValidatablePost = { text: string; hashtags: string[] };
export type ValidatePostOptions = { url: string; hasImage?: boolean };

const MAX_HASHTAGS = 2;

/**
 * Per-platform validation: human-readable issue strings, [] if clean. Pure
 * and dependency-free so it's importable from both API routes and
 * `"use client"` components (composer + research panel).
 */
export function validatePost(
  platform: Platform,
  post: ValidatablePost,
  opts: ValidatePostOptions,
): string[] {
  const issues: string[] = [];

  switch (platform) {
    case "x":
      if (post.text.length > X_MAX_LENGTH) {
        issues.push(`Text exceeds X's ${X_MAX_LENGTH} character limit`);
      }
      if (post.hashtags.length > MAX_HASHTAGS) {
        issues.push(`X posts work best with at most ${MAX_HASHTAGS} hashtags`);
      }
      break;
    case "reddit":
      if (post.hashtags.length > 0) {
        issues.push("Reddit posts shouldn't use hashtags");
      }
      break;
    case "instagram":
      if (!opts.hasImage) {
        issues.push("Instagram posts need a cover image");
      }
      if (post.hashtags.length === 0) {
        issues.push("Instagram posts should include at least one hashtag");
      }
      break;
    case "facebook":
      if (post.hashtags.length > MAX_HASHTAGS) {
        issues.push(`Facebook posts work best with at most ${MAX_HASHTAGS} hashtags`);
      }
      break;
  }

  if (!post.text.includes(opts.url)) {
    issues.push("Post is missing the source link");
  }

  return issues;
}
