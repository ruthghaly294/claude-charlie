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

  it("scores partial matches proportionally", () => {
    const r = scoreSignal("frcr only here", kw);
    expect(r.score).toBe(0.33);
    expect(r.cluster).toBe("frcr");
  });

  it("scores zero for irrelevant text", () => {
    const r = scoreSignal("pasta recipe", kw);
    expect(r.score).toBe(0);
    expect(r.cluster).toBe("unclustered");
  });

  it("applies feedback multipliers and clamps to 1", () => {
    const r = scoreSignal("frcr tips", kw, { frcr: 1.5 });
    expect(r.score).toBe(0.5); // 1.5 / 3
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
    expect(scoreSignal("RADIOLOGY", ["radiology"]).score).toBe(1);
  });
});
