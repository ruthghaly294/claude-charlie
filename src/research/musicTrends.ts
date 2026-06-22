import { runLast30Days, type ResearchItem, type ResearchReport } from "./last30days";

/**
 * Evidence-based read of a sound/track that is currently trending for a topic.
 * This is *trend evidence* only — the commercial track is never embedded into
 * generated media (see royaltyFreeMap.ts for the safe substitute we actually use).
 */
export type SoundTrend = {
  topic: string;
  title: string;
  url: string;
  whereTrending: string;
  engagement: number;
  mood: string;
  energy: "low" | "medium" | "high";
  /**
   * Native platform sound id (e.g. TikTok `song_id`). Captured for the in-app
   * "attach this trending sound at publish" step — the only licensed way to use
   * a commercial track. Absent for text-inferred sounds and the sample seed.
   */
  soundId?: string;
  /** Sound author/artist, when the chart provides it. */
  author?: string;
};

export type Energy = SoundTrend["energy"];

/** Runs the last30days research CLI for one query. Injected in tests. */
export type SoundRunner = (query: string) => Promise<ResearchReport>;

export type FindTrendingSoundsOptions = {
  runner?: SoundRunner;
  limit?: number;
  /**
   * Optional source of *real* trending sounds (e.g. the TikTok Creative Center
   * connector). When provided, these are merged with the text-inferred sounds
   * and ranked ahead of them. They remain evidence only — every track still
   * passes through mapToSafeTrack before any audio is used.
   */
  tiktokRunner?: (topic: string) => Promise<SoundTrend[]>;
};

/** whereTrending marker for sounds sourced from a real platform chart. */
export const REAL_CHART_SOURCE = "tiktok_sounds";

/** Query templates that surface trending sounds across short-form platforms. */
export const SOUND_QUERIES = [
  (t: string) => `trending TikTok sounds ${t}`,
  (t: string) => `${t} Instagram Reels trending audio`,
  (t: string) => `viral ${t} background music short video`,
] as const;

const DEFAULT_LIMIT = 15;

const MOOD_KEYWORDS: Record<string, string[]> = {
  chill: ["chill", "lofi", "lo-fi", "calm", "relax", "ambient"],
  upbeat: ["upbeat", "happy", "feel-good", "groovy", "pop"],
  hype: ["hype", "phonk", "drill", "trap", "bass", "energetic"],
  epic: ["epic", "cinematic", "trailer", "orchestral", "dramatic"],
  sad: ["sad", "emotional", "melancholic", "slow"],
};

const HIGH_ENERGY = ["hype", "phonk", "drill", "trap", "bass", "energetic", "epic", "fast"];
const LOW_ENERGY = ["chill", "lofi", "lo-fi", "calm", "relax", "ambient", "slow", "sad"];

function inferMood(text: string): string {
  const t = text.toLowerCase();
  for (const [mood, words] of Object.entries(MOOD_KEYWORDS)) {
    if (words.some((w) => t.includes(w))) return mood;
  }
  return "neutral";
}

function inferEnergy(text: string): Energy {
  const t = text.toLowerCase();
  if (HIGH_ENERGY.some((w) => t.includes(w))) return "high";
  if (LOW_ENERGY.some((w) => t.includes(w))) return "low";
  return "medium";
}

function engagementSum(item: ResearchItem): number {
  return Object.values(item.engagement).reduce((sum, n) => sum + n, 0);
}

/**
 * Build a SoundTrend from already-extracted fields, inferring mood/energy from
 * `text` (defaults to the title). Shared by the last30days text path and by
 * real-chart sources (e.g. the TikTok connector) so inference stays in one place.
 */
export function makeSoundTrend(
  topic: string,
  whereTrending: string,
  fields: {
    title: string;
    url: string;
    engagement: number;
    text?: string;
    soundId?: string;
    author?: string;
  },
): SoundTrend {
  const text = fields.text ?? fields.title;
  return {
    topic,
    title: fields.title,
    url: fields.url,
    whereTrending,
    engagement: fields.engagement,
    mood: inferMood(text),
    energy: inferEnergy(text),
    ...(fields.soundId ? { soundId: fields.soundId } : {}),
    ...(fields.author ? { author: fields.author } : {}),
  };
}

function toSoundTrend(topic: string, source: string, item: ResearchItem): SoundTrend {
  return makeSoundTrend(topic, source, {
    title: item.title,
    url: item.url,
    engagement: engagementSum(item),
    text: `${item.title} ${item.snippet}`,
  });
}

/**
 * Gather currently-trending sounds for a topic by running targeted last30days
 * queries across short-form platforms, deduped by URL (then title) and sorted
 * by engagement. Returns evidence only — map to a safe track before use.
 */
export async function findTrendingSounds(
  topic: string,
  opts: FindTrendingSoundsOptions = {},
): Promise<SoundTrend[]> {
  const runner: SoundRunner = opts.runner ?? ((q) => runLast30Days(q, { quick: true }));
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const reports = await Promise.all(SOUND_QUERIES.map((build) => runner(build(topic))));

  const byKey = new Map<string, SoundTrend>();
  const isReal = (t: SoundTrend) => t.whereTrending === REAL_CHART_SOURCE;
  const addCandidate = (candidate: SoundTrend) => {
    const key = candidate.url || candidate.title;
    const existing = byKey.get(key);
    if (
      !existing ||
      (isReal(candidate) && !isReal(existing)) ||
      (isReal(candidate) === isReal(existing) && candidate.engagement > existing.engagement)
    ) {
      byKey.set(key, candidate);
    }
  };

  for (const report of reports) {
    for (const [source, items] of Object.entries(report.itemsBySource)) {
      for (const item of items) addCandidate(toSoundTrend(topic, source, item));
    }
  }

  if (opts.tiktokRunner) {
    try {
      for (const trend of await opts.tiktokRunner(topic)) addCandidate(trend);
    } catch {
      // Real-chart fetch is best-effort (TikTok may 403/rate-limit); fall back
      // to the text-inferred sounds rather than failing the whole run.
    }
  }

  // Real-chart sounds rank ahead of text-inferred ones, then by engagement.
  return [...byKey.values()]
    .sort((a, b) => Number(isReal(b)) - Number(isReal(a)) || b.engagement - a.engagement)
    .slice(0, limit);
}
