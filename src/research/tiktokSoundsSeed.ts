import type { Energy } from "./musicTrends";

/**
 * SAMPLE / FALLBACK trending-sounds snapshot.
 *
 * This is NOT live data. It exists so the frontend can always render the
 * trending-sounds experience even when the live TikTok Creative Center API is
 * unreachable (e.g. blocked from a datacenter/Codespace IP, or no token set).
 * Every result built from this list is flagged `live: false` and badged
 * "SAMPLE" in the UI. The moment a real source returns data, live results are
 * used instead and this is ignored.
 */
export type SeedSound = {
  title: string;
  author: string;
  url: string;
  /** approximate videos-created/uses, used only to order the sample list */
  uses: number;
  mood: string;
  energy: Energy;
};

export const TIKTOK_SOUNDS_SEED: SeedSound[] = [
  {
    title: "original sound",
    author: "studiobeats",
    url: "https://www.tiktok.com/music/original-sound-studiobeats",
    uses: 1_280_000,
    mood: "hype",
    energy: "high",
  },
  {
    title: "sped up phonk house",
    author: "nightdrive",
    url: "https://www.tiktok.com/music/sped-up-phonk-house",
    uses: 940_000,
    mood: "hype",
    energy: "high",
  },
  {
    title: "lofi study loop",
    author: "calmwave",
    url: "https://www.tiktok.com/music/lofi-study-loop",
    uses: 610_000,
    mood: "chill",
    energy: "low",
  },
  {
    title: "feel good summer pop",
    author: "sunrooms",
    url: "https://www.tiktok.com/music/feel-good-summer-pop",
    uses: 530_000,
    mood: "upbeat",
    energy: "medium",
  },
  {
    title: "epic cinematic build",
    author: "scorelab",
    url: "https://www.tiktok.com/music/epic-cinematic-build",
    uses: 480_000,
    mood: "epic",
    energy: "high",
  },
  {
    title: "soft emotional piano",
    author: "keysandrain",
    url: "https://www.tiktok.com/music/soft-emotional-piano",
    uses: 360_000,
    mood: "sad",
    energy: "low",
  },
  {
    title: "groovy funk bassline",
    author: "discofloor",
    url: "https://www.tiktok.com/music/groovy-funk-bassline",
    uses: 295_000,
    mood: "upbeat",
    energy: "medium",
  },
  {
    title: "ambient chill pads",
    author: "slowhorizon",
    url: "https://www.tiktok.com/music/ambient-chill-pads",
    uses: 210_000,
    mood: "chill",
    energy: "low",
  },
];
