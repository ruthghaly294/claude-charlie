import { makeSoundTrend, type SoundTrend } from "./musicTrends";
import { mapToSafeTrack, type SafeTrack, type RoyaltyFreeLibrary } from "./royaltyFreeMap";
import { TIKTOK_SOUNDS_SEED } from "./tiktokSoundsSeed";
import { tiktokSoundsConnector } from "@/discovery/connectors";
import type { ConnectorContext } from "@/discovery/types";

export type TrendingSound = { trend: SoundTrend; safe: SafeTrack };

export type TrendingSoundsResult = {
  /** true when the rows came from the live TikTok chart; false = sample fallback. */
  live: boolean;
  topic: string;
  sounds: TrendingSound[];
};

export type GetTrendingSoundsOptions = {
  topic?: string;
  /** decode.config.yml sources.tiktok_sounds block (region/period/limit etc.). */
  connectorConfig?: unknown;
  /** default royalty-free provider for the safe substitute. */
  musicProvider?: string;
  /** operator's own royalty-free library, keyed by mood. */
  library?: RoyaltyFreeLibrary;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  limit?: number;
  /** ms before the live fetch is abandoned in favour of the sample fallback. */
  liveTimeoutMs?: number;
};

/** Build evidence-only SoundTrends from the sample snapshot. */
function seedTrends(topic: string): SoundTrend[] {
  return TIKTOK_SOUNDS_SEED.map((s) => ({
    topic,
    title: `${s.title} — ${s.author}`,
    url: s.url,
    whereTrending: "tiktok_sounds",
    engagement: s.uses,
    mood: s.mood,
    energy: s.energy,
  }));
}

/**
 * Trending sounds for the frontend panel. Tries the live TikTok chart only when
 * there's a realistic chance of success (operator enabled it, or a token is
 * set); otherwise — and on any live failure (e.g. a datacenter/Codespace IP
 * being blocked) — it returns a clearly-flagged sample snapshot so the UI always
 * renders. Either way every track is mapped to its royalty-free substitute, so
 * the commercial-audio compliance rule is preserved.
 */
export async function getTrendingSounds(
  opts: GetTrendingSoundsOptions = {},
): Promise<TrendingSoundsResult> {
  const topic = opts.topic?.trim() || "trending";
  const limit = opts.limit ?? 12;
  const env = opts.env ?? {};
  const userCfg = (opts.connectorConfig ?? {}) as Record<string, unknown>;
  const wantLive = userCfg.enabled === true || Boolean(env.TIKTOK_CC_TOKEN);

  let trends: SoundTrend[] = [];
  let live = false;

  if (wantLive) {
    try {
      const ctx: ConnectorContext = {
        keywords: [topic],
        businessName: topic,
        config: { ...userCfg, enabled: true },
        env,
        fetchImpl: opts.fetchImpl ?? fetch,
        signal: AbortSignal.timeout(opts.liveTimeoutMs ?? 2500),
      };
      if (tiktokSoundsConnector.state(ctx).configured) {
        const signals = await tiktokSoundsConnector.fetch(ctx);
        trends = signals.map((s) =>
          makeSoundTrend(topic, "tiktok_sounds", {
            title: s.title,
            url: s.url,
            engagement: s.points ?? 0,
            soundId: s.externalId,
            author: s.author || undefined,
          }),
        );
        live = trends.length > 0;
      }
    } catch {
      // Live chart unreachable — fall back to the sample snapshot below.
    }
  }

  if (trends.length === 0) {
    trends = seedTrends(topic);
    live = false;
  }

  const sounds = trends.slice(0, limit).map((trend) => ({
    trend,
    safe: mapToSafeTrack(trend, { provider: opts.musicProvider, library: opts.library }),
  }));

  return { live, topic, sounds };
}
