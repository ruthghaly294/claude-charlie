/**
 * License-cleared stock video for the "stock" reuse lane. This is the compliant
 * counterpart to the audio invariant: only rights-cleared footage (Pexels
 * License = free, royalty-free, no attribution required) is ever returned for
 * rendering/hosting. The provider records provenance (author + source URL) so a
 * credit can still be shown even though the license doesn't require it.
 */
export type StockClip = {
  id: string;
  /** direct video file URL (rendered/hosted downstream) */
  url: string;
  width: number;
  height: number;
  durationSec: number;
  provider: string;
  author: string;
  sourceUrl: string;
  licence: string;
  /** true only when the licence permits embedding into a hosted asset */
  embeddable: boolean;
};

export type StockSearchOptions = {
  orientation?: "portrait" | "landscape" | "square";
  perPage?: number;
  /** prefer clips at least this long (seconds) so there's room to trim a hook→payoff */
  minDurationSec?: number;
};

export type StockProvider = {
  readonly name: string;
  configured: boolean;
  search(query: string, opts?: StockSearchOptions): Promise<StockClip[]>;
};

const PEXELS_LICENCE = "Pexels License (royalty-free, no attribution required)";

type PexelsVideoFile = {
  link: string;
  quality?: string;
  width?: number | null;
  height?: number | null;
  file_type?: string;
};

type PexelsVideo = {
  id: number;
  width: number;
  height: number;
  duration: number;
  url: string;
  user?: { name?: string; url?: string };
  video_files?: PexelsVideoFile[];
};

/**
 * Pick the highest-resolution mp4 rendition (HD preferred) so the downstream
 * reframe/crop has pixels to work with.
 */
export function pickBestVideoFile(files: PexelsVideoFile[]): PexelsVideoFile | null {
  const mp4 = files.filter((f) => (f.file_type ?? "").includes("mp4") || f.link.includes(".mp4"));
  const pool = mp4.length ? mp4 : files;
  if (!pool.length) return null;
  return [...pool].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]!;
}

export type PexelsProviderOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

export function makePexelsProvider(opts: PexelsProviderOptions = {}): StockProvider {
  const apiKey = opts.apiKey;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? "https://api.pexels.com/videos/search";

  return {
    name: "pexels",
    configured: Boolean(apiKey),
    async search(query, searchOpts = {}) {
      if (!apiKey) return [];
      const params = new URLSearchParams({
        query,
        orientation: searchOpts.orientation ?? "portrait",
        per_page: String(searchOpts.perPage ?? 15),
      });
      const res = await fetchImpl(`${baseUrl}?${params.toString()}`, {
        headers: { authorization: apiKey },
      });
      if (!res.ok) {
        throw new Error(`Pexels search failed (${res.status})`);
      }
      const json = (await res.json()) as { videos?: PexelsVideo[] };
      const minDuration = searchOpts.minDurationSec ?? 0;
      const clips: StockClip[] = [];
      for (const v of json.videos ?? []) {
        if (v.duration < minDuration) continue;
        const best = pickBestVideoFile(v.video_files ?? []);
        if (!best) continue;
        clips.push({
          id: String(v.id),
          url: best.link,
          width: best.width ?? v.width,
          height: best.height ?? v.height,
          durationSec: v.duration,
          provider: "pexels",
          author: v.user?.name ?? "",
          sourceUrl: v.url,
          licence: PEXELS_LICENCE,
          embeddable: true,
        });
      }
      return clips;
    },
  };
}

export function getStockProvider(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): StockProvider {
  return makePexelsProvider({ apiKey: env.PEXELS_API_KEY, fetchImpl });
}
