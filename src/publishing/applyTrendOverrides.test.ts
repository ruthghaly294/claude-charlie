import { describe, it, expect } from "vitest";
import { applyTrendOverrides } from "./runTrendImitation";
import { DEFAULT_TREND_IMITATION_CONFIG } from "@/discovery/config";

describe("applyTrendOverrides — promptVariants", () => {
  it("carries a non-empty selection onto the trend config", () => {
    const out = applyTrendOverrides(DEFAULT_TREND_IMITATION_CONFIG, {
      promptVariants: { "brief.system": "punchy" },
    });
    expect(out.promptVariants).toEqual({ "brief.system": "punchy" });
  });

  it("leaves promptVariants unset when the selection is empty or absent", () => {
    expect(applyTrendOverrides(DEFAULT_TREND_IMITATION_CONFIG, {}).promptVariants).toBeUndefined();
    expect(
      applyTrendOverrides(DEFAULT_TREND_IMITATION_CONFIG, { promptVariants: {} }).promptVariants,
    ).toBeUndefined();
  });

  it("carries pasted manual research (trimmed-empty is ignored)", () => {
    expect(
      applyTrendOverrides(DEFAULT_TREND_IMITATION_CONFIG, { manualResearch: "  paste me  " }).manualResearch,
    ).toBe("  paste me  ");
    expect(
      applyTrendOverrides(DEFAULT_TREND_IMITATION_CONFIG, { manualResearch: "   " }).manualResearch,
    ).toBeUndefined();
  });

  it("does not mutate the input config", () => {
    const before = { ...DEFAULT_TREND_IMITATION_CONFIG };
    applyTrendOverrides(DEFAULT_TREND_IMITATION_CONFIG, { promptVariants: { "video.scaffold": "fast-cut" } });
    expect(DEFAULT_TREND_IMITATION_CONFIG).toEqual(before);
  });
});
