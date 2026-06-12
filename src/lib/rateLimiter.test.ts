import { describe, it, expect } from "vitest";
import { RateLimiter, domainOf } from "./rateLimiter";

/** Fake clock + sleep where sleep(ms) advances the clock instantly. */
function fakeClock() {
  let now = 0;
  return {
    clock: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

describe("domainOf", () => {
  it("extracts the hostname from a url", () => {
    expect(domainOf("https://api.github.com/search/repositories?q=x")).toBe(
      "api.github.com",
    );
  });

  it("falls back to 'default' for unparseable urls", () => {
    expect(domainOf("not a url")).toBe("default");
  });
});

describe("RateLimiter", () => {
  it("starts each domain's bucket full at its configured rps", () => {
    const { clock, sleep } = fakeClock();
    const limiter = new RateLimiter(
      { default: { rps: 1, concurrency: 2 }, "a.com": { rps: 5, concurrency: 1 } },
      { clock, sleep },
    );
    expect(limiter.stats("a.com").tokens).toBeCloseTo(5);
    expect(limiter.stats("b.com").tokens).toBeCloseTo(1); // falls back to default
  });

  it("throttles to the configured requests-per-second via a token bucket", async () => {
    const { clock, sleep } = fakeClock();
    const limiter = new RateLimiter(
      { default: { rps: 1, concurrency: 5 } },
      { clock, sleep },
    );
    const startedAt: number[] = [];
    for (let i = 0; i < 3; i++) {
      await limiter.schedule("x.com", async () => {
        startedAt.push(clock());
      });
    }
    expect(startedAt[0]).toBe(0);
    expect(startedAt[1]).toBeGreaterThanOrEqual(1000);
    expect(startedAt[2]).toBeGreaterThanOrEqual(2000);
  });

  it("caps in-flight requests per domain to the configured concurrency", async () => {
    const { clock, sleep } = fakeClock();
    const limiter = new RateLimiter(
      { default: { rps: 1000, concurrency: 1 } },
      { clock, sleep },
    );
    let inFlight = 0;
    let maxInFlight = 0;
    const task = () =>
      limiter.schedule("x.com", async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep(10);
        inFlight--;
      });
    await Promise.all([task(), task(), task()]);
    expect(maxInFlight).toBe(1);
  });

  it("uses the 'default' limits for domains without a specific entry", async () => {
    const { clock, sleep } = fakeClock();
    const limiter = new RateLimiter(
      { default: { rps: 1, concurrency: 5 } },
      { clock, sleep },
    );
    await limiter.schedule("unconfigured.example", async () => {});
    expect(limiter.stats("unconfigured.example").tokens).toBeCloseTo(0);
  });

  it("AutoThrottle-lite: stretches the delay after a slow call", async () => {
    const { clock, sleep } = fakeClock();
    const limiter = new RateLimiter(
      { default: { rps: 100, concurrency: 5 } },
      { clock, sleep, autoThrottleThresholdMs: 100, autoThrottleFactor: 1 },
    );
    await limiter.schedule("slow.com", async () => {
      await sleep(500); // simulate a slow upstream response
    });
    const before = clock();
    await limiter.schedule("slow.com", async () => {});
    // 500ms latency - 100ms threshold, factor 1 => ~400ms extra delay
    expect(clock() - before).toBeGreaterThanOrEqual(400);
  });

  it("does not stretch delay when latency stays under the threshold", async () => {
    const { clock, sleep } = fakeClock();
    const limiter = new RateLimiter(
      { default: { rps: 100, concurrency: 5 } },
      { clock, sleep, autoThrottleThresholdMs: 1000 },
    );
    await limiter.schedule("fast.com", async () => {
      await sleep(10);
    });
    const before = clock();
    await limiter.schedule("fast.com", async () => {});
    expect(clock() - before).toBeLessThan(10);
  });
});
