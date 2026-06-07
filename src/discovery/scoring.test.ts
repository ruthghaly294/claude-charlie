import { describe, it, expect } from "vitest";
import { slugify, hashKey, scoreSignal } from "./scoring";

describe("slugify", () => {
  it("lowercases and dashes", () => {
    expect(slugify("FRCR Viva: Tips!")).toBe("frcr-viva-tips");
  });
});

describe("hashKey", () => {
  it("is stable for the same url", () => {
    expect(hashKey("https://x/1", "t")).toBe(hashKey("https://x/1", "t2"));
  });
  it("falls back to title when url empty", () => {
    expect(hashKey("", "title")).toBe(hashKey("", "title"));
    expect(hashKey("", "a")).not.toBe(hashKey("", "b"));
  });
});

describe("scoreSignal", () => {
  const kw = ["radiology", "frcr", "viva"];

  it("scores all-matching text near 1.0", () => {
    const r = scoreSignal("radiology frcr viva content", kw);
    expect(r.score).toBe(1);
  });

  it("scores a single match at 0.5 and two matches at 1.0", () => {
    const one = scoreSignal("frcr only here", kw);
    expect(one.score).toBe(0.5);
    expect(one.cluster).toBe("frcr");
    expect(scoreSignal("radiology frcr here", kw).score).toBe(1);
  });

  it("does not suppress a single match as the keyword list grows", () => {
    const few = scoreSignal("frcr", ["frcr", "alpha", "beta"]);
    const many = scoreSignal("frcr", [
      "frcr",
      "alpha",
      "beta",
      "gamma",
      "delta",
      "omega",
    ]);
    expect(few.score).toBe(0.5);
    expect(many.score).toBe(0.5); // independent of list length (was 1/6 before)
  });

  it("scores zero for irrelevant text", () => {
    const r = scoreSignal("pasta recipe", kw);
    expect(r.score).toBe(0);
    expect(r.cluster).toBe("unclustered");
  });

  it("applies feedback multipliers and clamps to 1", () => {
    expect(scoreSignal("frcr tips", kw, { frcr: 1.5 }).score).toBe(0.75); // 1.5 / 2
    expect(scoreSignal("frcr tips", kw, { frcr: 3 }).score).toBe(1); // clamped
  });

  it("keeps everything at 1.0 when no keywords configured", () => {
    expect(scoreSignal("anything", []).score).toBe(1);
  });

  it("falls back to the given cluster when no keyword matches", () => {
    const r = scoreSignal("pasta recipe", kw, {}, "reddit");
    expect(r.score).toBe(0);
    expect(r.cluster).toBe("reddit");
  });

  it("uses the fallback cluster even with no keywords configured", () => {
    const r = scoreSignal("anything", [], {}, "github_trending");
    expect(r.score).toBe(1);
    expect(r.cluster).toBe("github_trending");
  });

  it("is case-insensitive", () => {
    const upper = scoreSignal("RADIOLOGY", ["radiology"]).score;
    expect(upper).toBe(scoreSignal("radiology", ["radiology"]).score);
    expect(upper).toBeGreaterThan(0);
  });
});
