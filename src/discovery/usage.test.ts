import { describe, it, expect } from "vitest";
import { priceUsd, UsageMeter } from "./usage";

describe("priceUsd", () => {
  it("prices Opus 4.8 at $5/$25 per 1M tokens", () => {
    expect(priceUsd("claude-opus-4-8", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(5);
    expect(priceUsd("claude-opus-4-8", { inputTokens: 0, outputTokens: 1_000_000 })).toBe(25);
  });
  it("prices DeepSeek V4 Pro from its own (cheaper) entry, not the default", () => {
    const inPrice = priceUsd("deepseek/deepseek-v4-pro", {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(inPrice).toBe(0.5);
    expect(inPrice).toBeLessThan(
      priceUsd("claude-opus-4-8", { inputTokens: 1_000_000, outputTokens: 0 }),
    );
  });
  it("falls back to a default price for unknown models", () => {
    expect(
      priceUsd("mystery", { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBeGreaterThan(0);
  });
});

describe("UsageMeter", () => {
  it("accumulates tokens and cost across calls", () => {
    const m = new UsageMeter();
    m.record("claude-opus-4-8", { inputTokens: 1000, outputTokens: 500 });
    m.record("claude-opus-4-8", { inputTokens: 1000, outputTokens: 500 });
    expect(m.totals.tokensIn).toBe(2000);
    expect(m.totals.tokensOut).toBe(1000);
    expect(m.totals.costUsd).toBeGreaterThan(0);
  });
});
