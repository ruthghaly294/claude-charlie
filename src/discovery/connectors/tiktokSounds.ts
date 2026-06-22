import { z } from "zod";
import type { Connector, ConnectorContext, RawSignal } from "../types";
import { fetchJson } from "../fetchWithRetry";

// TikTok Creative Center surfaces trending sounds via its `creative_radar_api`
// (the same endpoint its web UI calls). It is unofficial: it expects a
// browser-like User-Agent, may rate-limit / 403 datacenter IPs, and sometimes
// wants an auth token. So this connector is OFF by default (config.enabled) and
// every request shape is config-driven, so a future endpoint/region change is a
// YAML edit rather than a code change. When TIKTOK_CC_TOKEN is set it is sent as
// a bearer token; TIKTOK_CC_USER_ID (the anonymous-user-id header) is optional.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const cfgSchema = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z
    .string()
    .default(
      "https://ads.tiktok.com/creative_radar_api/v1/popular_trend/sound/list",
    ),
  region: z.string().default("US"),
  /** trailing window in days the API ranks over (commonly 7 / 30 / 120) */
  period: z.number().default(7),
  rankType: z.string().default("popular"),
  limit: z.number().default(20),
});

// Tolerant: the API has shifted field names over time, so everything past the
// list itself is optional and a song with no id/link still yields a signal.
const apiSchema = z.object({
  data: z
    .object({
      sound_list: z
        .array(
          z
            .object({
              song_id: z.union([z.string(), z.number()]).optional(),
              title: z.string().default(""),
              author: z.string().default(""),
              link: z.string().optional(),
              rank: z.number().optional(),
              user_count: z.number().optional(),
              play_count: z.number().optional(),
            })
            .passthrough(),
        )
        .default([]),
    })
    .partial()
    .default({}),
});

export const tiktokSoundsConnector: Connector = {
  key: "tiktok_sounds",
  label: "TikTok Trending Sounds",
  requiresKeys: [],

  state(ctx: ConnectorContext) {
    const c = cfgSchema.safeParse(ctx.config ?? {});
    if (!c.success || !c.data.enabled) {
      return { configured: false, reason: "disabled in config" };
    }
    return { configured: true };
  },

  async fetch(ctx: ConnectorContext): Promise<RawSignal[]> {
    const cfg = cfgSchema.parse(ctx.config ?? {});

    const url =
      `${cfg.baseUrl}?period=${encodeURIComponent(String(cfg.period))}` +
      `&page=1&limit=${encodeURIComponent(String(cfg.limit))}` +
      `&rank_type=${encodeURIComponent(cfg.rankType)}` +
      `&country_code=${encodeURIComponent(cfg.region)}`;

    const headers: Record<string, string> = { "user-agent": UA };
    if (ctx.env.TIKTOK_CC_TOKEN) {
      headers.authorization = `Bearer ${ctx.env.TIKTOK_CC_TOKEN}`;
    }
    if (ctx.env.TIKTOK_CC_USER_ID) {
      headers["anonymous-user-id"] = ctx.env.TIKTOK_CC_USER_ID;
    }

    const data = await fetchJson(
      url,
      apiSchema,
      { headers },
      { fetchImpl: ctx.fetchImpl, signal: ctx.signal },
    );

    const list = data.data.sound_list ?? [];
    const out: RawSignal[] = [];
    list.forEach((s, i) => {
      const songId = s.song_id != null ? String(s.song_id) : undefined;
      const titleText = s.title || `sound ${songId ?? i + 1}`;
      const author = s.author ?? "";
      // Prefer real usage metrics; otherwise preserve trending order so the
      // per-source social percentile still ranks earlier sounds higher.
      const points = s.play_count ?? s.user_count ?? cfg.limit - i;
      out.push({
        source: "tiktok_sounds",
        title: author ? `${titleText} — ${author}` : titleText,
        url: s.link ?? (songId ? `https://www.tiktok.com/music/${songId}` : ""),
        author,
        publishedAt: "",
        tags: ["tiktok", "sound", cfg.region],
        raw: "",
        points: points || undefined,
        authorKey: author ? `tiktok:${author.toLowerCase()}` : undefined,
        externalId: songId,
      });
    });
    return out;
  },
};
