import { describe, it, expect } from "vitest";
import { createDb } from "@/db/client";
import {
  PROMPT_KEYS,
  PROMPT_DEFAULTS,
  resolvePrompt,
  loadPromptOverrides,
  savePromptOverride,
  clearPromptOverride,
  buildEditorialInfographicPrompt,
  formatContentStructure,
} from "./prompts";

describe("resolvePrompt", () => {
  it("fills {placeholder} tokens from vars in the built-in default", () => {
    const out = resolvePrompt("judge.system", { context: "\n\nBrand voice: punchy" });
    expect(out).toContain("Brand voice: punchy");
    expect(out).not.toContain("{context}");
  });

  it("missing vars become empty string, not the literal token", () => {
    const out = resolvePrompt("brief.system", {});
    expect(out).not.toContain("{voiceContext}");
  });

  it("an override fully replaces the default template before filling vars", () => {
    const out = resolvePrompt("video.scaffold", { topic: "x", videoPrompt: "y", soundMood: "z" }, {
      "video.scaffold": "custom template mood={soundMood}",
    });
    expect(out).toBe("custom template mood=z");
  });

  it("no override for the key falls back to the built-in default", () => {
    const out = resolvePrompt("exemplars.system", {}, { "brief.system": "irrelevant" });
    expect(out).toBe(PROMPT_DEFAULTS["exemplars.system"].template);
  });
});

describe("editorial infographic prompt", () => {
  const structure = {
    mainTitle: "Spin-echo contrast mechanisms",
    sections: [
      { header: "Before", bullets: ["T1 weighting", "Short TR/TE"] },
      { header: "After", bullets: ["T2 weighting"] },
    ],
  };

  it("formats sections into the numbered Section/bullet block", () => {
    const out = formatContentStructure(structure);
    expect(out).toContain("Section 1 — Before");
    expect(out).toContain("  1. T1 weighting");
    expect(out).toContain("  2. Short TR/TE");
    expect(out).toContain("Section 2 — After");
    expect(out).toContain("  1. T2 weighting");
  });

  it("fills the title and content into the editorial template, leaving no raw tokens", () => {
    const out = buildEditorialInfographicPrompt(structure);
    expect(out).toContain("Spin-echo contrast mechanisms");
    expect(out).toContain("Section 1 — Before");
    expect(out).not.toContain("{mainTitle}");
    expect(out).not.toContain("{contentStructure}");
    // brand house-style markers survive
    expect(out).toContain("watercolor");
  });

  it("the brand background prompt forbids rendered text and needs no placeholders", () => {
    expect(PROMPT_DEFAULTS["infographic.brandBackground"].placeholders).toEqual([]);
    const out = resolvePrompt("infographic.brandBackground");
    expect(out).toMatch(/NO text|no words|NO words/i);
    expect(out).not.toContain("{");
  });
});

describe("DB-backed prompt overrides", () => {
  it("round-trips save → load → clear for every prompt key", () => {
    const db = createDb(":memory:");
    expect(loadPromptOverrides(db)).toEqual({});

    for (const key of PROMPT_KEYS) {
      savePromptOverride(db, key, `custom-${key}`, "2026-06-18T00:00:00.000Z");
    }
    const loaded = loadPromptOverrides(db);
    for (const key of PROMPT_KEYS) {
      expect(loaded[key]).toBe(`custom-${key}`);
    }

    clearPromptOverride(db, PROMPT_KEYS[0]);
    const afterClear = loadPromptOverrides(db);
    expect(afterClear[PROMPT_KEYS[0]]).toBeUndefined();
    expect(afterClear[PROMPT_KEYS[1]]).toBe(`custom-${PROMPT_KEYS[1]}`);
  });

  it("saving twice for the same key upserts rather than duplicating", () => {
    const db = createDb(":memory:");
    savePromptOverride(db, "judge.system", "first", "2026-06-18T00:00:00.000Z");
    savePromptOverride(db, "judge.system", "second", "2026-06-18T00:01:00.000Z");
    expect(loadPromptOverrides(db)["judge.system"]).toBe("second");
  });
});
