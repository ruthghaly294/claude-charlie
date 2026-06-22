import { describe, it, expect } from "vitest";
import { buildQotdCarousel, composeQotdPostText, cleanExplanation } from "./qotdCarousel";
import type { BrandConfig } from "@/discovery/config";
import type { ExamQuestion } from "@/db/schema";

const brand: BrandConfig = {
  handle: "@frcrbank",
  name: "FRCRBank",
  description: "FRCR question bank",
  voice: "evidence-based",
  audience: "ST1 radiology trainees",
  signupUrl: "https://frcrbank.com",
  ctaPrimary: "Follow @frcrbank for a daily FRCR Physics question · Save this",
  ctaSecondary: "Full worked explanations → link in bio",
  contentPillars: [],
};

function q(over: Partial<ExamQuestion>): ExamQuestion {
  return {
    id: "x",
    subtopic: "MRI physics",
    statement: "T1 is the longitudinal relaxation time.",
    correctAnswer: true,
    explanation: "T1 describes recovery of longitudinal magnetisation. It is field-dependent.",
    difficulty: "Easy",
    source: "question_bank:1",
    usedAt: null,
    createdAt: "2026-06-20T00:00:00Z",
    ...over,
  };
}

describe("cleanExplanation", () => {
  it("drops the unreliable verdict prefix and filler tail (the badge states TRUE/FALSE)", () => {
    const raw =
      "This statement is correct. Three dimensional acquisitions generally require longer scan times than two dimensional acquisitions occurs as described as a consequence of the underlying physics, with causes and effects conforming to fundamental principles.";
    const out = cleanExplanation(raw);
    expect(out).toBe("Three dimensional acquisitions generally require longer scan times than two dimensional acquisitions.");
    expect(out).not.toMatch(/this statement is/i);
    expect(out).not.toMatch(/fundamental principles/i);
  });

  it("strips a 'This statement is incorrect because …' prefix and capitalises the remainder", () => {
    const out = cleanExplanation("This statement is incorrect because for a given rf bandwidth a stronger gradient produces thinner slices. Extra.");
    expect(out).toBe("For a given rf bandwidth a stronger gradient produces thinner slices.");
  });

  it("leaves a clean explanation as its first sentence", () => {
    expect(cleanExplanation("Chemical shift arises because nuclei differ. More detail here.")).toBe(
      "Chemical shift arises because nuclei differ.",
    );
  });
});

describe("buildQotdCarousel", () => {
  it("the answer-slide explanation never contradicts the badge (no leftover verdict prefix)", () => {
    const c = buildQotdCarousel(
      [q({ correctAnswer: false, statement: "X is shorter than Y.", explanation: "This statement is correct. X is longer than Y occurs as described as a consequence of the underlying physics." })],
      brand,
    );
    const ans = c.slides.find((s) => s.role === "answer");
    expect(ans && ans.role === "answer" && ans.answer).toBe(false);
    expect(ans && ans.role === "answer" && ans.explanation).toBe("X is longer than Y.");
  });

  it("builds a questions slide + one answer slide per statement + CTA", () => {
    const c = buildQotdCarousel([q({ statement: "s1" }), q({ statement: "s2" }), q({ statement: "s3" })], brand);
    const first = c.slides[0];
    expect(first?.role).toBe("questions");
    expect(first?.role === "questions" && first.items).toHaveLength(3);
    expect(first?.role === "questions" && first.items[0]).toEqual({ label: "a)", statement: "s1" });
    expect(c.slides.at(-1)?.role).toBe("cta");
    const answers = c.slides.filter((s) => s.role === "answer");
    expect(answers).toHaveLength(3);
    expect(answers[0]).toMatchObject({ label: "a)", index: 1, total: 3 });
    expect(answers[2]).toMatchObject({ label: "c)" });
  });

  it("keeps answers off the questions slide (viewer commits before the reveal)", () => {
    const c = buildQotdCarousel([q({ statement: "s1", correctAnswer: false })], brand);
    const first = c.slides[0];
    expect(first?.role === "questions" && JSON.stringify(first.items)).not.toContain("FALSE");
    expect(first?.role === "questions" && JSON.stringify(first.items)).not.toContain("answer");
  });

  it("states a concrete fact in the caption (not a tease)", () => {
    const c = buildQotdCarousel([q({ statement: "T1 is the longitudinal relaxation time.", correctAnswer: true })], brand);
    expect(c.caption).toContain("T1 is the longitudinal relaxation time.");
    expect(c.caption.toLowerCase()).not.toMatch(/nobody tells you|the finding that|you won't believe/);
    expect(c.caption).toContain("link in bio");
  });

  it("uses the explanation's correction as the caption fact when the lead statement is false", () => {
    const c = buildQotdCarousel(
      [q({ statement: "Higher frequency increases wavelength.", correctAnswer: false, explanation: "Higher frequency shortens wavelength. They are inversely related." })],
      brand,
    );
    expect(c.caption).toContain("Higher frequency shortens wavelength.");
    expect(c.caption).not.toContain("Higher frequency increases wavelength.");
  });

  it("trims explanation to one sentence on the answer slide and keeps the verbatim statement", () => {
    const c = buildQotdCarousel([q({})], brand);
    const card = c.slides.find((s) => s.role === "answer");
    expect(card && card.role === "answer" && card.statement).toBe("T1 is the longitudinal relaxation time.");
    expect(card && card.role === "answer" && card.explanation).toBe(
      "T1 describes recovery of longitudinal magnetisation.",
    );
  });

  it("derives subtopic hashtags and composes post text", () => {
    const c = buildQotdCarousel([q({ subtopic: "CT physics" })], brand);
    expect(c.hashtags).toContain("frcr");
    expect(c.hashtags).toContain("ctphysics");
    const text = composeQotdPostText(c);
    expect(text).toContain(c.caption);
    expect(text).toContain("#frcr");
  });
});
