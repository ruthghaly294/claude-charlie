import { describe, it, expect, vi } from "vitest";
import { isWeakExplanation } from "./supabaseQuestions";
import { detectWeakRows, buildRegenUser, proposeExplanation, REGEN_SYSTEM, type WeakRow } from "./regenerateExplanations";
import type { PostGenClient } from "./postGenerator";

describe("isWeakExplanation", () => {
  it("flags the verdict prefix, filler boilerplate, and empty/short values", () => {
    expect(isWeakExplanation("This statement is correct. X occurs as described.")).toBe(true);
    expect(isWeakExplanation("Foo bar baz, with causes and effects conforming to fundamental principles.")).toBe(true);
    expect(isWeakExplanation("X occurs as described as a consequence of the underlying physics, with...")).toBe(true);
    expect(isWeakExplanation("")).toBe(true);
    expect(isWeakExplanation("Too short")).toBe(true);
    expect(isWeakExplanation(null)).toBe(true);
  });

  it("passes a clean, substantive explanation", () => {
    expect(isWeakExplanation("Fat protons are shielded relative to water, so their Larmor frequencies differ by ~3.5 ppm.")).toBe(false);
  });
});

const row = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  id: "id-1",
  question_text: "3D acquisitions require shorter scan times than 2D.",
  correct_answer: false,
  explanation1: "This statement is correct. 3D requires longer occurs as described as a consequence of the underlying physics.",
  explanation:
    "## Core Principle\n3D acquisitions sample an extra phase-encoding direction, so they generally require LONGER scan times than comparable 2D acquisitions, traded for thinner contiguous slices and higher SNR.",
  ...over,
});

describe("detectWeakRows", () => {
  it("selects weak+groundable rows and separates ones with no usable long explanation", () => {
    const good = row({ id: "good", explanation1: "Fat protons are shielded relative to water, so frequencies differ by ~3.5 ppm." });
    const groundable = row({ id: "g1" });
    const ungrounded = row({ id: "u1", explanation: "short" });
    const { regenerate, ungrounded: un } = detectWeakRows([good, groundable, ungrounded]);
    expect(regenerate.map((r) => r.id)).toEqual(["g1"]);
    expect(un.map((r) => r.id)).toEqual(["u1"]);
    expect(regenerate[0]).toMatchObject({ correctAnswer: false, statement: expect.stringContaining("3D acquisitions") });
  });

  it("skips rows missing an id or statement", () => {
    expect(detectWeakRows([row({ id: "" }), row({ question_text: "" })]).regenerate).toHaveLength(0);
  });

  it("does not select rows whose explanation1 is already good", () => {
    const r = row({ explanation1: "3D acquisitions sample an extra phase-encoding step, so they take longer than 2D." });
    expect(detectWeakRows([r]).regenerate).toHaveLength(0);
  });
});

describe("proposeExplanation", () => {
  const weak: WeakRow = {
    id: "id-1",
    statement: "3D acquisitions require shorter scan times than 2D.",
    correctAnswer: false,
    longExplanation: "3D adds a phase-encoding direction so scans take longer than 2D.",
    current: "This statement is correct. ...",
  };

  it("grounds the prompt in the verified long explanation and the answer", () => {
    const user = buildRegenUser(weak);
    expect(user).toContain("ANSWER: FALSE");
    expect(user).toContain("3D adds a phase-encoding direction");
    expect(REGEN_SYSTEM).toMatch(/Ground every claim ONLY in the VERIFIED/i);
  });

  it("returns a cleaned before/after proposal from the model JSON", async () => {
    const client: PostGenClient = {
      complete: vi.fn(async () => ({ content: '{"explanation":"  3D acquisitions take LONGER than 2D because they add a phase-encoding direction.  "}' })),
    };
    const p = await proposeExplanation(client, "test-model", weak);
    expect(p).toMatchObject({ id: "id-1", correctAnswer: false, before: weak.current });
    expect(p.after).toBe("3D acquisitions take LONGER than 2D because they add a phase-encoding direction.");
    expect(p.after).not.toMatch(/this statement is/i);
  });
});
