import { describe, it, expect } from "vitest";
import { CircuitBreaker } from "./circuitBreaker";

function fakeClock(start = 0) {
  let now = start;
  return { clock: () => now, advance: (ms: number) => (now += ms) };
}

describe("CircuitBreaker", () => {
  it("starts closed and allows runs", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    expect(breaker.canRun("rss")).toBe(true);
    expect(breaker.getRecord("rss").state).toBe("closed");
  });

  it("stays closed below the failure threshold", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    breaker.recordFailure("rss");
    breaker.recordFailure("rss");
    expect(breaker.canRun("rss")).toBe(true);
    expect(breaker.getRecord("rss").state).toBe("closed");
    expect(breaker.getRecord("rss").consecutiveFailures).toBe(2);
  });

  it("opens once the failure threshold is reached, blocking further runs", () => {
    const { clock } = fakeClock(1000);
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000, clock });
    breaker.recordFailure("rss");
    breaker.recordFailure("rss");
    breaker.recordFailure("rss");
    expect(breaker.getRecord("rss").state).toBe("open");
    expect(breaker.getRecord("rss").openUntil).toBe(1000 + 60_000);
    expect(breaker.canRun("rss")).toBe(false);
  });

  it("a success resets the breaker to closed", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000 });
    breaker.recordFailure("rss");
    breaker.recordFailure("rss"); // now open
    expect(breaker.canRun("rss")).toBe(false);
    // (test only verifies recordSuccess directly resets state, not via canRun)
    breaker.recordSuccess("rss");
    expect(breaker.getRecord("rss")).toEqual({
      state: "closed",
      consecutiveFailures: 0,
      openUntil: null,
    });
  });

  it("transitions open -> half-open after the cooldown elapses, allowing a trial run", () => {
    const { clock, advance } = fakeClock(0);
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 5000, clock });
    breaker.recordFailure("rss");
    expect(breaker.getRecord("rss").state).toBe("open");
    expect(breaker.canRun("rss")).toBe(false);

    advance(5000);
    expect(breaker.canRun("rss")).toBe(true);
    expect(breaker.getRecord("rss").state).toBe("half-open");
  });

  it("a failed half-open trial re-opens with a fresh cooldown", () => {
    const { clock, advance } = fakeClock(0);
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 5000, clock });
    breaker.recordFailure("rss"); // open, openUntil = 5000
    advance(5000);
    breaker.canRun("rss"); // -> half-open
    breaker.recordFailure("rss"); // trial failed -> open again
    expect(breaker.getRecord("rss").state).toBe("open");
    expect(breaker.getRecord("rss").openUntil).toBe(10_000);
  });

  it("a successful half-open trial closes the breaker and clears the failure count", () => {
    const { clock, advance } = fakeClock(0);
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 5000, clock });
    breaker.recordFailure("rss");
    advance(5000);
    breaker.canRun("rss"); // -> half-open
    breaker.recordSuccess("rss");
    expect(breaker.getRecord("rss")).toEqual({
      state: "closed",
      consecutiveFailures: 0,
      openUntil: null,
    });
  });

  it("seeds initial records (persistence round-trip) and tracks keys independently", () => {
    const breaker = new CircuitBreaker(
      { failureThreshold: 3, cooldownMs: 1000 },
      {
        github_trending: {
          state: "open",
          consecutiveFailures: 5,
          openUntil: Date.now() + 999_999_999,
        },
      },
    );
    expect(breaker.canRun("github_trending")).toBe(false);
    expect(breaker.canRun("rss")).toBe(true);
  });

  it("snapshot reflects all touched keys", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    breaker.recordFailure("rss");
    breaker.recordSuccess("github_trending");
    const snap = breaker.snapshot();
    expect(snap.rss?.consecutiveFailures).toBe(1);
    expect(snap.github_trending?.state).toBe("closed");
  });
});
