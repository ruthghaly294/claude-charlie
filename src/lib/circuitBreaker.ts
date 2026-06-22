export type BreakerStateName = "closed" | "open" | "half-open";

export type BreakerRecord = {
  state: BreakerStateName;
  consecutiveFailures: number;
  /** epoch ms after which an open breaker may try a half-open trial */
  openUntil: number | null;
};

export type CircuitBreakerOptions = {
  /** consecutive failures before a (closed or half-open) breaker opens */
  failureThreshold: number;
  /** how long an opened breaker stays open before allowing a trial */
  cooldownMs: number;
  /** injectable clock (ms), defaults to Date.now */
  clock?: () => number;
};

const DEFAULT_RECORD: BreakerRecord = {
  state: "closed",
  consecutiveFailures: 0,
  openUntil: null,
};

/**
 * Per-key closed/open/half-open circuit breaker. `canRun` flips an open
 * breaker to half-open once its cooldown elapses and allows a single trial;
 * `recordSuccess`/`recordFailure` then close it again or re-open it with a
 * fresh cooldown.
 */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly clock: () => number;
  private readonly records = new Map<string, BreakerRecord>();

  constructor(
    opts: CircuitBreakerOptions,
    initial: Record<string, BreakerRecord> = {},
  ) {
    this.failureThreshold = opts.failureThreshold;
    this.cooldownMs = opts.cooldownMs;
    this.clock = opts.clock ?? Date.now;
    for (const [key, rec] of Object.entries(initial)) {
      this.records.set(key, { ...rec });
    }
  }

  private recordFor(key: string): BreakerRecord {
    let rec = this.records.get(key);
    if (!rec) {
      rec = { ...DEFAULT_RECORD };
      this.records.set(key, rec);
    }
    return rec;
  }

  /** Can `key` run right now? Open breakers past their cooldown become half-open. */
  canRun(key: string): boolean {
    const rec = this.recordFor(key);
    if (rec.state === "open") {
      if (rec.openUntil !== null && this.clock() >= rec.openUntil) {
        rec.state = "half-open";
        return true;
      }
      return false;
    }
    return true;
  }

  /** Record a successful run: closes the breaker and clears its failure count. */
  recordSuccess(key: string): void {
    const rec = this.recordFor(key);
    rec.state = "closed";
    rec.consecutiveFailures = 0;
    rec.openUntil = null;
  }

  /** Record a failed run: opens the breaker once `failureThreshold` is reached
   * (or immediately re-opens a half-open trial), with a fresh cooldown. */
  recordFailure(key: string): void {
    const rec = this.recordFor(key);
    rec.consecutiveFailures += 1;
    if (rec.state === "half-open" || rec.consecutiveFailures >= this.failureThreshold) {
      rec.state = "open";
      rec.openUntil = this.clock() + this.cooldownMs;
    }
  }

  /** Current state for `key` (closed if never touched). */
  getRecord(key: string): BreakerRecord {
    return { ...this.recordFor(key) };
  }

  /** All touched keys' current state, for persistence. */
  snapshot(): Record<string, BreakerRecord> {
    const out: Record<string, BreakerRecord> = {};
    for (const [key, rec] of this.records) out[key] = { ...rec };
    return out;
  }
}
