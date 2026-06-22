import { mapWithConcurrency } from "@/lib/concurrency";
import { isAllowed } from "@/lib/robots";

/**
 * Content-extraction layer: actually FETCH the page behind a discovery link and
 * pull its readable main text, so the pipeline can ground a post in real content
 * — a NotebookLM-free alternative for the "read the sources" step. Best-effort
 * and robots-aware; any page that's disallowed, errors, or yields too little
 * text is simply skipped.
 */

export const RESEARCH_USER_AGENT = "DecodeResearchBot";

const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_MAX_CHARS = 4000;
const MIN_USEFUL_CHARS = 200;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Strip HTML to readable text: drop boilerplate blocks, prefer <article>/<main>, collapse whitespace. */
export function extractReadableText(html: string, maxChars: number = DEFAULT_MAX_CHARS): string {
  // Remove non-content blocks wholesale (incl. their text).
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head|nav|footer|header|form|aside)\b[\s\S]*?<\/\1>/gi, " ");

  // Prefer the main article body when the page marks one.
  const main = s.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ?? s.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (main?.[1] && main[1].length > MIN_USEFUL_CHARS) s = main[1];

  const text = s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();

  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export type ScrapedSource = { url: string; title?: string; text: string };

export type FetchPageOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxChars?: number;
  /** shared robots.txt cache across a batch */
  robotsCache?: Map<string, string | null>;
  /** skip the robots.txt check (default false — we honor robots). */
  ignoreRobots?: boolean;
};

/** Fetch one page and return its readable text, or null if blocked/empty/errored. */
export async function fetchPageText(
  url: string,
  opts: FetchPageOptions = {},
): Promise<string | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    if (!opts.ignoreRobots) {
      const allowed = await isAllowed(url, RESEARCH_USER_AGENT, {
        fetchImpl,
        cache: opts.robotsCache,
      });
      if (!allowed) return null;
    }
    const res = await fetchImpl(url, {
      headers: { "user-agent": RESEARCH_USER_AGENT },
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (ct && !ct.includes("html") && !ct.includes("text")) return null;
    const text = extractReadableText(await res.text(), opts.maxChars);
    return text.length >= MIN_USEFUL_CHARS ? text : null;
  } catch {
    return null;
  }
}

export type ScrapeOptions = FetchPageOptions & {
  /** how many sources to fetch (default 5) */
  limit?: number;
  concurrency?: number;
};

/**
 * Fetch readable text for up to `limit` of the given picks (URL + optional
 * title), concurrently. Pages that fail or are blocked are dropped.
 */
export async function scrapeSources(
  picks: { url: string; title?: string }[],
  opts: ScrapeOptions = {},
): Promise<ScrapedSource[]> {
  const targets = picks.slice(0, opts.limit ?? 5);
  const robotsCache = opts.robotsCache ?? new Map<string, string | null>();
  const results = await mapWithConcurrency<{ url: string; title?: string }, ScrapedSource | null>(
    targets,
    opts.concurrency ?? 4,
    async (pick) => {
      const text = await fetchPageText(pick.url, { ...opts, robotsCache });
      return text ? { url: pick.url, ...(pick.title ? { title: pick.title } : {}), text } : null;
    },
  );
  return results.filter((r): r is ScrapedSource => r !== null);
}
