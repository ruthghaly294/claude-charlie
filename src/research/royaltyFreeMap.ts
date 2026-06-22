import type { SoundTrend } from "./musicTrends";

/**
 * A legally-safe substitute for a trending commercial sound. We record the
 * trend as evidence but only ever feed royalty-free / CC / owned audio to the
 * generator. `trackUrl` is non-null (and `embeddable` true) only when a curated
 * royalty-free library supplies a concrete file for the mood.
 */
export type SafeTrack = {
  mood: string;
  energy: string;
  /** royalty-free source to search (or the source of `trackUrl`). */
  provider: string;
  /** query to find a matching royalty-free track in the provider. */
  searchQuery: string;
  licence: string;
  /** concrete royalty-free file/URL, when a curated mapping exists; else null. */
  trackUrl: string | null;
  /** whether this may be passed to Higgsfield `--audio`. */
  embeddable: boolean;
  note: string;
};

/** Map from mood → operator-supplied royalty-free track URL. */
export type RoyaltyFreeLibrary = Record<string, string>;

export type MapToSafeTrackOptions = {
  /** operator's own royalty-free/CC/owned tracks keyed by mood. */
  library?: RoyaltyFreeLibrary;
  /** default search provider when no curated track exists. */
  provider?: string;
};

const DEFAULT_PROVIDER = "youtube_audio_library";

const PROVIDER_BY_MOOD: Record<string, string> = {
  chill: "pixabay",
  upbeat: "pixabay",
  hype: "uppbeat",
  epic: "uppbeat",
  sad: "pixabay",
};

const NOT_EMBEDDABLE_NOTE =
  "Trending track is commercial — not embedded. Use the royalty-free match, or add the platform-native sound in-app at publish time.";

/**
 * Convert a trending-sound evidence row into a safe track recommendation. When
 * the operator provides a royalty-free library entry for the mood, that concrete
 * track is used and marked embeddable; otherwise we emit a provider + search
 * query for a manual/automated royalty-free pick (never the commercial track).
 */
export function mapToSafeTrack(trend: SoundTrend, opts: MapToSafeTrackOptions = {}): SafeTrack {
  const mood = trend.mood;
  const energy = trend.energy;
  const supplied = opts.library?.[mood];

  if (supplied) {
    return {
      mood,
      energy,
      provider: "operator-library",
      searchQuery: `${mood} ${energy} energy`,
      licence: "royalty-free",
      trackUrl: supplied,
      embeddable: true,
      note: "Operator-supplied royalty-free track.",
    };
  }

  const provider = opts.provider ?? PROVIDER_BY_MOOD[mood] ?? DEFAULT_PROVIDER;
  return {
    mood,
    energy,
    provider,
    searchQuery: `${mood} ${energy} energy royalty-free ${trend.topic} short video`,
    licence: "royalty-free",
    trackUrl: null,
    embeddable: false,
    note: NOT_EMBEDDABLE_NOTE,
  };
}
