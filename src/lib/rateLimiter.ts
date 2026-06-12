/** Per-domain rate limit: requests/second + max concurrent in-flight requests. */
export type DomainLimitConfig = {
  rps: number;
  concurrency: number;
};

export type RateLimiterOptions = {
  /** injectable clock (ms), defaults to Date.now */
  clock?: () => number;
  /** injectable sleep, defaults to a real setTimeout-based wait */
  sleep?: (ms: number) => Promise<void>;
  /** AutoThrottle-lite: rolling-avg latency above this triggers extra delay */
  autoThrottleThresholdMs?: number;
  /** AutoThrottle-lite: extra delay = (avgLatencyMs - threshold) * factor */
  autoThrottleFactor?: number;
  /** AutoThrottle-lite: cap on the extra delay */
  autoThrottleMaxDelayMs?: number;
};

const FALLBACK_LIMIT: DomainLimitConfig = { rps: 1, concurrency: 2 };

type DomainState = {
  tokens: number;
  lastRefill: number;
  active: number;
  queue: Array<() => void>;
  avgLatencyMs: number;
};

/** Extract the hostname from a url; "default" for anything unparseable. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "default";
  }
}

/**
 * Per-domain token-bucket rate limiter + concurrency cap, with an
 * AutoThrottle-lite escape hatch that stretches delays when a domain's
 * rolling-average latency spikes. Wrap `ctx.fetchImpl` with `schedule()`
 * keyed by `domainOf(url)`.
 */
export class RateLimiter {
  private readonly limits: Record<string, DomainLimitConfig>;
  private readonly states = new Map<string, DomainState>();
  private readonly clock: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly throttleThresholdMs: number;
  private readonly throttleFactor: number;
  private readonly throttleMaxDelayMs: number;

  constructor(
    limits: Record<string, DomainLimitConfig> = {},
    opts: RateLimiterOptions = {},
  ) {
    this.limits = limits;
    this.clock = opts.clock ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.throttleThresholdMs = opts.autoThrottleThresholdMs ?? 3000;
    this.throttleFactor = opts.autoThrottleFactor ?? 0.5;
    this.throttleMaxDelayMs = opts.autoThrottleMaxDelayMs ?? 5000;
  }

  private configFor(domain: string): DomainLimitConfig {
    return this.limits[domain] ?? this.limits.default ?? FALLBACK_LIMIT;
  }

  private stateFor(domain: string): DomainState {
    let state = this.states.get(domain);
    if (!state) {
      const cfg = this.configFor(domain);
      state = {
        tokens: Math.max(1, cfg.rps),
        lastRefill: this.clock(),
        active: 0,
        queue: [],
        avgLatencyMs: 0,
      };
      this.states.set(domain, state);
    }
    return state;
  }

  private refill(domain: string, state: DomainState): void {
    const cfg = this.configFor(domain);
    const now = this.clock();
    const elapsedSec = Math.max(0, (now - state.lastRefill) / 1000);
    const capacity = Math.max(1, cfg.rps);
    state.tokens = Math.min(capacity, state.tokens + elapsedSec * cfg.rps);
    state.lastRefill = now;
  }

  private async acquireToken(domain: string, state: DomainState): Promise<void> {
    const cfg = this.configFor(domain);
    for (;;) {
      this.refill(domain, state);
      if (state.tokens >= 1) {
        state.tokens -= 1;
        return;
      }
      const deficit = 1 - state.tokens;
      const waitMs = (deficit / Math.max(cfg.rps, 0.001)) * 1000;
      await this.sleep(Math.max(1, waitMs));
    }
  }

  private async acquireSlot(state: DomainState, concurrency: number): Promise<void> {
    if (state.active < Math.max(1, concurrency)) {
      state.active += 1;
      return;
    }
    await new Promise<void>((resolve) => state.queue.push(resolve));
    state.active += 1;
  }

  private releaseSlot(state: DomainState): void {
    state.active -= 1;
    const next = state.queue.shift();
    if (next) next();
  }

  /** Run `fn` once this domain's rate limit, concurrency cap, and AutoThrottle delay allow it. */
  async schedule<T>(domain: string, fn: () => Promise<T>): Promise<T> {
    const state = this.stateFor(domain);
    const cfg = this.configFor(domain);

    await this.acquireToken(domain, state);
    await this.acquireSlot(state, cfg.concurrency);

    if (state.avgLatencyMs > this.throttleThresholdMs) {
      const extra = Math.min(
        this.throttleMaxDelayMs,
        (state.avgLatencyMs - this.throttleThresholdMs) * this.throttleFactor,
      );
      if (extra > 0) await this.sleep(extra);
    }

    const started = this.clock();
    try {
      return await fn();
    } finally {
      const latency = this.clock() - started;
      state.avgLatencyMs =
        state.avgLatencyMs === 0
          ? latency
          : state.avgLatencyMs * 0.7 + latency * 0.3;
      this.releaseSlot(state);
    }
  }

  /** Current bucket/latency state for a domain (for tests + health reporting). */
  stats(domain: string): { tokens: number; active: number; avgLatencyMs: number } {
    const state = this.stateFor(domain);
    this.refill(domain, state);
    return {
      tokens: state.tokens,
      active: state.active,
      avgLatencyMs: state.avgLatencyMs,
    };
  }
}
