import { describe, it, expect } from "vitest";
import { createDb } from "@/db/client";
import { PROMPT_KEYS, PROMPT_DEFAULTS, type PromptKey } from "./prompts";
import {
  PROMPT_VARIANTS,
  DEFAULT_VARIANT_ID,
  resolveVariantTemplates,
  seedPromptVariants,
  restorePromptVariants,
  loadVariantCatalog,
  createPromptVariant,
  updatePromptVariant,
  deletePromptVariant,
} from "./promptVariants";

function placeholdersIn(template: string): Set<string> {
  return new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!));
}

// Canonical brand prompts: edited via overrides, never swapped for strategic
// alternates, so they intentionally ship with no variants.
const NO_ALTERNATE_KEYS: PromptKey[] = ["infographic.editorial", "infographic.brandBackground"];

describe("PROMPT_VARIANTS built-in library", () => {
  it("covers every strategic stage with ~5 distinct alternates", () => {
    for (const key of PROMPT_KEYS) {
      const variants = PROMPT_VARIANTS[key];
      const ids = variants.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).not.toContain(DEFAULT_VARIANT_ID);
      if (NO_ALTERNATE_KEYS.includes(key)) {
        expect(variants).toHaveLength(0);
      } else {
        expect(variants.length).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it("preserves each stage's required placeholders in every variant", () => {
    for (const key of PROMPT_KEYS) {
      const required = PROMPT_DEFAULTS[key].placeholders;
      for (const variant of PROMPT_VARIANTS[key]) {
        const present = placeholdersIn(variant.template);
        for (const ph of required) {
          expect(present.has(ph), `${key}/${variant.id} must keep {${ph}}`).toBe(true);
        }
      }
    }
  });
});

describe("resolveVariantTemplates (pure / built-ins)", () => {
  const aKey: PromptKey = "brief.system";
  const aVariant = PROMPT_VARIANTS[aKey][0]!;

  it("returns the chosen variant's template keyed by stage", () => {
    expect(resolveVariantTemplates({ [aKey]: aVariant.id })[aKey]).toBe(aVariant.template);
  });

  it("skips default, unknown ids, and unknown keys", () => {
    expect(resolveVariantTemplates({ [aKey]: DEFAULT_VARIANT_ID })).toEqual({});
    expect(resolveVariantTemplates({ [aKey]: "nope", "bad.key": "x" })).toEqual({});
  });

  it("returns {} for undefined / empty selection", () => {
    expect(resolveVariantTemplates()).toEqual({});
    expect(resolveVariantTemplates({})).toEqual({});
  });
});

describe("seedPromptVariants + loadVariantCatalog", () => {
  it("seeds built-ins once and lists them with a default option first", () => {
    const db = createDb(":memory:");
    const catalog = loadVariantCatalog(db); // seeds on first load
    for (const stage of catalog) {
      expect(stage.variants[0]!.id).toBe(DEFAULT_VARIANT_ID);
      expect(stage.variants.length).toBe(PROMPT_VARIANTS[stage.key].length + 1);
    }
  });

  it("does not duplicate built-ins on a second seed", () => {
    const db = createDb(":memory:");
    seedPromptVariants(db);
    const first = loadVariantCatalog(db)[0]!.variants.length;
    seedPromptVariants(db);
    expect(loadVariantCatalog(db)[0]!.variants.length).toBe(first);
  });
});

describe("CRUD", () => {
  it("creates, resolves (DB-backed), updates, and deletes a custom variant", () => {
    const db = createDb(":memory:");
    seedPromptVariants(db);
    const key: PromptKey = "brief.system";

    const { variantId } = createPromptVariant(db, {
      key,
      label: "My Spicy Take",
      description: "house style",
      template: "Spicy brief. {voiceContext}",
    });
    expect(variantId).toBe("my-spicy-take");

    // DB-backed resolution finds the custom template.
    expect(resolveVariantTemplates({ [key]: variantId }, db)[key]).toBe("Spicy brief. {voiceContext}");

    expect(updatePromptVariant(db, `${key}:${variantId}`, { template: "Edited. {voiceContext}" })).toBe(true);
    expect(resolveVariantTemplates({ [key]: variantId }, db)[key]).toBe("Edited. {voiceContext}");

    expect(deletePromptVariant(db, `${key}:${variantId}`)).toBe(true);
    expect(resolveVariantTemplates({ [key]: variantId }, db)).toEqual({});
  });

  it("derives a unique variantId when labels collide", () => {
    const db = createDb(":memory:");
    const key: PromptKey = "video.scaffold";
    const a = createPromptVariant(db, { key, label: "Dupe", template: "{videoPrompt} {topic} {soundMood}" });
    const b = createPromptVariant(db, { key, label: "Dupe", template: "{videoPrompt} {topic} {soundMood}" });
    expect(a.variantId).toBe("dupe");
    expect(b.variantId).toBe("dupe-2");
  });

  it("restorePromptVariants re-adds a deleted built-in", () => {
    const db = createDb(":memory:");
    seedPromptVariants(db);
    const key: PromptKey = "judge.system";
    const builtinId = PROMPT_VARIANTS[key][0]!.id;
    expect(deletePromptVariant(db, `${key}:${builtinId}`)).toBe(true);
    expect(resolveVariantTemplates({ [key]: builtinId }, db)).toEqual({});

    const added = restorePromptVariants(db);
    expect(added).toBeGreaterThanOrEqual(1);
    expect(resolveVariantTemplates({ [key]: builtinId }, db)[key]).toBe(PROMPT_VARIANTS[key][0]!.template);
  });
});
