/**
 * A pool of OpenRouter API keys that the LLM "decision brain" shares so batch
 * runs can use every key concurrently. It round-robins across keys, fails over
 * to the next key on rate limits / transient 5xx (honoring `Retry-After`),
 * permanently drops keys the API rejects (401/403), and caps in-flight requests
 * so we never exceed the combined throughput of the pool.
 *
 * The single-key path is preserved: a pool built from one key behaves exactly
 * like the original `fetch`-backed client, so existing callers are unaffected.
 */

export type OpenRouterCompletion = {
  content: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export type OpenRouterPoolOptions = {
  keys: string[];
  baseUrl?: string;
  /** Max requests in flight across the whole pool. Defaults to the key count. */
  maxConcurrency?: number;
  /** Total key attempts per request before giving up. Defaults to keys.length * 2. */
  maxAttempts?: number;
  /** Upper bound on a single backoff sleep. */
  maxBackoffMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

type KeyState = {
  key: string;
  dead: boolean;
  /** Epoch ms before which this key should not be used (rate-limit cooldown). */
  availableAt: number;
  failCount: number;
};

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const BASE_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

/**
 * Read the key pool from the environment. Prefers `OPENROUTER_API_KEYS`
 * (comma-separated) and falls back to the legacy single `OPENROUTER_API_KEY`.
 */
export function parseOpenRouterKeys(
  env: Record<string, string | undefined>,
): string[] {
  const multi = env.OPENROUTER_API_KEYS;
  const raw = multi && multi.trim() ? multi : (env.OPENROUTER_API_KEY ?? "");
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const part of raw.split(",")) {
    const k = part.trim();
    if (k && !seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return null;
}

export class OpenRouterPoolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterPoolError";
  }
}

/** OpenAI-compatible message, plus the variants reasoning/cloaked models use. */
type OpenRouterMessage = {
  content?: string | { type?: string; text?: string }[] | null;
  /** some reasoning models leave `content` null and put the answer here */
  reasoning?: string | null;
  reasoning_content?: string | null;
};

/**
 * Pull the text out of a chat message, tolerating the shapes reasoning/cloaked
 * models (e.g. owl-alpha) actually return: a plain string, an array of content
 * parts, or `content: null` with the text in a `reasoning` field. Returns "" when
 * there's genuinely nothing usable.
 */
export function extractMessageContent(msg: OpenRouterMessage | undefined): string {
  if (!msg) return "";
  if (typeof msg.content === "string" && msg.content.trim()) return msg.content;
  if (Array.isArray(msg.content)) {
    const text = msg.content
      .map((p) => (typeof p === "string" ? p : (p?.text ?? "")))
      .join("")
      .trim();
    if (text) return text;
  }
  if (typeof msg.reasoning === "string" && msg.reasoning.trim()) return msg.reasoning;
  if (typeof msg.reasoning_content === "string" && msg.reasoning_content.trim()) {
    return msg.reasoning_content;
  }
  return "";
}

export class OpenRouterKeyPool {
  private readonly states: KeyState[];
  private readonly baseUrl: string;
  private readonly maxConcurrency: number;
  private readonly maxAttempts: number;
  private readonly maxBackoffMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private cursor = 0;
  private inFlight = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(opts: OpenRouterPoolOptions) {
    if (!opts.keys.length) {
      throw new OpenRouterPoolError("OpenRouterKeyPool requires at least one key");
    }
    this.states = opts.keys.map((key) => ({
      key,
      dead: false,
      availableAt: 0,
      failCount: 0,
    }));
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.maxConcurrency = opts.maxConcurrency ?? opts.keys.length;
    this.maxAttempts = opts.maxAttempts ?? opts.keys.length * 2;
    this.maxBackoffMs = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.states.length;
  }

  get activeSize(): number {
    return this.states.filter((s) => !s.dead).length;
  }

  private async acquireSlot(): Promise<void> {
    if (this.inFlight < this.maxConcurrency) {
      this.inFlight += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.inFlight += 1;
  }

  private releaseSlot(): void {
    this.inFlight -= 1;
    const next = this.waiters.shift();
    if (next) next(); // wake one waiter; it re-checks and increments inFlight
  }

  /**
   * Pick the next usable key, round-robin, skipping dead and cooled-down keys.
   * Returns null when keys exist but are all cooling down; throws when every
   * key is dead.
   */
  private selectKey(): KeyState | { waitMs: number } {
    const live = this.states.filter((s) => !s.dead);
    if (!live.length) {
      throw new OpenRouterPoolError(
        "OpenRouter pool exhausted: every key was rejected (401/403)",
      );
    }
    const now = this.now();
    const n = this.states.length;
    for (let i = 0; i < n; i += 1) {
      const state = this.states[(this.cursor + i) % n]!;
      if (!state.dead && state.availableAt <= now) {
        this.cursor = (this.cursor + i + 1) % n;
        return state;
      }
    }
    const soonest = Math.min(...live.map((s) => s.availableAt));
    return { waitMs: Math.max(0, soonest - now) };
  }

  private backoffMs(state: KeyState): number {
    const exp = BASE_BACKOFF_MS * 2 ** Math.min(state.failCount, 6);
    const jitter = Math.random() * BASE_BACKOFF_MS;
    return Math.min(this.maxBackoffMs, exp + jitter);
  }

  async complete(body: Record<string, unknown>): Promise<OpenRouterCompletion> {
    await this.acquireSlot();
    try {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
        const picked = this.selectKey();
        if ("waitMs" in picked) {
          await this.sleep(picked.waitMs);
          continue;
        }
        const state = picked;
        let res: Response;
        try {
          res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${state.key}`,
            },
            body: JSON.stringify(body),
          });
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          state.failCount += 1;
          state.availableAt = this.now() + this.backoffMs(state);
          continue;
        }

        if (res.ok) {
          state.failCount = 0;
          state.availableAt = 0;
          const json = (await res.json()) as {
            choices?: { message?: OpenRouterMessage }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const content = extractMessageContent(json.choices?.[0]?.message);
          if (!content) {
            // A 200 with no usable text is a transient provider hiccup (common on
            // free-tier models under load). Retry on another key/attempt rather
            // than failing the whole call on the first empty response.
            state.failCount += 1;
            state.availableAt = this.now() + this.backoffMs(state);
            lastError = new OpenRouterPoolError("OpenRouter response missing message content");
            continue;
          }
          return { content, usage: json.usage };
        }

        const detail = await res.text().catch(() => "");
        if (res.status === 401 || res.status === 403) {
          state.dead = true;
          lastError = new OpenRouterPoolError(
            `OpenRouter key rejected (${res.status})${detail ? `: ${detail}` : ""}`,
          );
          continue;
        }
        if (res.status === 429 || res.status >= 500) {
          state.failCount += 1;
          const retryAfter = parseRetryAfterMs(
            res.headers.get("retry-after"),
            this.now(),
          );
          state.availableAt =
            this.now() + (retryAfter ?? this.backoffMs(state));
          lastError = new OpenRouterPoolError(
            `OpenRouter request throttled (${res.status})${detail ? `: ${detail}` : ""}`,
          );
          continue;
        }
        throw new OpenRouterPoolError(
          `OpenRouter request failed (${res.status})${detail ? `: ${detail}` : ""}`,
        );
      }
      throw (
        lastError ??
        new OpenRouterPoolError("OpenRouter pool exhausted all attempts")
      );
    } finally {
      this.releaseSlot();
    }
  }
}
