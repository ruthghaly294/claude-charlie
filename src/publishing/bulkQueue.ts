import { PLATFORMS, type Platform } from "./postGenerator";

export type DraftVariant = { text: string; hashtags: string[]; issues: string[] };

export type BulkProvenance = {
  topic: string;
  /** Omit when there's no source item to link back to (e.g. originally-drafted content). */
  itemUrl?: string;
  itemTitle: string;
  keyword: string;
};

/** Body for one POST /api/buffer/posts call produced by "Queue all". */
export type BulkComposeInput = BulkProvenance & {
  channelId: string;
  platform: Platform;
  text: string;
  imageUrl?: string;
  saveToDraft: boolean;
};

/**
 * Build one /api/buffer/posts compose input per platform that has a
 * configured channel, carrying provenance for published_posts tracking
 * (research/dedup.ts, publishing/postFeedback.ts). Platforms whose generated
 * variant has validation issues (research/validate.ts) are sent with
 * saveToDraft: true so the operator reviews them before they go out.
 */
export function buildBulkComposeInputs(
  drafts: Record<Platform, DraftVariant>,
  channelsByPlatform: Partial<Record<Platform, string>>,
  provenance: BulkProvenance,
  imageUrlByPlatform: Partial<Record<Platform, string>> = {},
): BulkComposeInput[] {
  const inputs: BulkComposeInput[] = [];
  for (const platform of PLATFORMS) {
    const channelId = channelsByPlatform[platform];
    if (!channelId) continue;

    const draft = drafts[platform];
    const imageUrl = imageUrlByPlatform[platform];
    inputs.push({
      ...provenance,
      channelId,
      platform,
      text: draft.text,
      ...(imageUrl ? { imageUrl } : {}),
      saveToDraft: draft.issues.length > 0,
    });
  }
  return inputs;
}
