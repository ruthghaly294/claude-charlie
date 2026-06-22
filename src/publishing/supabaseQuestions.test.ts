import { describe, it, expect } from "vitest";
import { resolveSupabaseSource, mapQuestionBankRow, humaniseSubtopic } from "./supabaseQuestions";

describe("resolveSupabaseSource", () => {
  it("returns null without url+key", () => {
    expect(resolveSupabaseSource({})).toBeNull();
    expect(resolveSupabaseSource({ SUPABASE_URL: "https://x.supabase.co" })).toBeNull();
  });

  it("prefers the service key and strips a trailing slash", () => {
    const s = resolveSupabaseSource({
      SUPABASE_URL: "https://x.supabase.co/",
      SUPABASE_SERVICE_KEY: "svc",
      SUPABASE_ANON_KEY: "anon",
    });
    expect(s).toEqual({ url: "https://x.supabase.co", key: "svc" });
  });
});

describe("humaniseSubtopic", () => {
  it("turns a snake_case category into a readable subtopic with acronyms", () => {
    expect(humaniseSubtopic("ultrasound_physics")).toBe("Ultrasound physics");
    expect(humaniseSubtopic("ct_physics")).toBe("CT physics");
    expect(humaniseSubtopic("mri_physics")).toBe("MRI physics");
    expect(humaniseSubtopic("x_ray_physics")).toBe("X-ray physics");
    expect(humaniseSubtopic("nuclear_medicine_physics")).toBe("Nuclear medicine physics");
  });
});

describe("mapQuestionBankRow", () => {
  it("maps a real question_bank row (single T/F statement)", () => {
    const q = mapQuestionBankRow({
      id: "6b12901e",
      category: "ultrasound_physics",
      question_text: "The spatial pulse length equals cycles divided by the wavelength.",
      correct_answer: false,
      explanation1: "SPL equals cycles multiplied by wavelength.",
      explanation: "## Core Principle ... long markdown",
      difficulty: "Easy",
    });
    expect(q.subtopic).toBe("Ultrasound physics");
    expect(q.statement).toContain("spatial pulse length");
    expect(q.correctAnswer).toBe(false);
    expect(q.explanation).toBe("SPL equals cycles multiplied by wavelength.");
    expect(q.difficulty).toBe("Easy");
    expect(q.source).toBe("question_bank:6b12901e");
  });

  it("preserves a true answer and falls back to the long explanation if no concise one", () => {
    const q = mapQuestionBankRow({
      id: 9,
      category: "mri_physics",
      question_text: "T1 is the longitudinal relaxation time.",
      correct_answer: true,
      explanation: "Recovery of longitudinal magnetisation.",
    });
    expect(q.correctAnswer).toBe(true);
    expect(q.explanation).toBe("Recovery of longitudinal magnetisation.");
  });

  it("throws on a row missing the statement", () => {
    expect(() =>
      mapQuestionBankRow({ category: "x", correct_answer: true, explanation1: "y" }),
    ).toThrow();
  });
});
