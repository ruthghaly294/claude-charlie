import { z } from "zod";

export type FetchRetryOptions = {
  /** number of RETRIES after the first attempt (default 3 → 4 attempts max) */
  retries?: number;
  /** per-attempt timeout (default 10s) */
  timeoutMs?: number;
  /** base backoff delay (default 300ms), grows exponentially */
  baseDelayMs?: number;
  /** backoff cap (default 5s) */
  maxDelayMs?: number;
  fetchImpl?: typeof fetch;
  /** injectable sleep for tests */
  sleep?: (ms: number) => Promise<void>;
  /** caller cancellation */
  signal?: AbortSignal;
  /** decide if a response status warrants a retry (default: 429 + 5xx) */
  isRetryableStatus?: (status: number) => boolean;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

const defaultRetryable = (status: number) => status === 429 || status >= 500;

function backoff(attempt: number, base: number, max: number): number {
  const exp = base * 2 ** attempt;
  const jitter = Math.random() * base;
  return Math.min(max, exp + jitter);
}

function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(h);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/**
 * fetch() with per-attempt timeout and exponential-backoff retries on network
 * errors, 429, and 5xx. Honors Retry-After. Composes the caller's AbortSignal
 * with the timeout. Returns the final Response even if not ok (caller inspects),
 * but throws if every attempt errored/timed out.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: FetchRetryOptions = {},
): Promise<Response> {
  const {
    retries = 3,
    timeoutMs = 10_000,
    baseDelayMs = 300,
    maxDelayMs = 5_000,
    fetchImpl = fetch,
    sleep = defaultSleep,
    signal,
    isRetryableStatus = defaultRetryable,
  } = opts;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const timeout = AbortSignal.timeout(timeoutMs);
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

    try {
      const res = await fetchImpl(url, { ...init, signal: composed });

      if (res.ok || !isRetryableStatus(res.status)) return res;

      // retryable status
      if (attempt < retries) {
        const wait =
          retryAfterMs(res) ?? backoff(attempt, baseDelayMs, maxDelayMs);
        await sleep(wait);
        continue;
      }
      return res; // exhausted retries — hand back the last response
    } catch (err) {
      lastError = err;
      // caller-initiated abort: do not retry
      if (signal?.aborted) throw err;
      if (attempt < retries) {
        await sleep(backoff(attempt, baseDelayMs, maxDelayMs));
        continue;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`fetch failed: ${url}`);
}

/** fetchWithRetry + JSON parse + zod validation. Throws on non-ok or bad shape. */
export async function fetchJson<T>(
  url: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
  opts: FetchRetryOptions = {},
): Promise<T> {
  const res = await fetchWithRetry(url, init, opts);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const json: unknown = await res.json();
  return schema.parse(json);
}

/** fetchWithRetry returning text (for RSS/Atom). Throws on non-ok. */
export async function fetchText(
  url: string,
  init: RequestInit = {},
  opts: FetchRetryOptions = {},
): Promise<string> {
  const res = await fetchWithRetry(url, init, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
