import { describe, it, expect } from "vitest";
import { priorityScore, valueScore, effortHours } from "./score";

describe("valueScore", () => {
  it("buckets monthly $ potential into 1–3", () => {
    expect(valueScore(0)).toBe(1);
    expect(valueScore(300)).toBe(2);
    expect(valueScore(5000)).toBe(3);
  });
});

describe("priorityScore", () => {
  it("rewards high impact/confidence/value and low effort", () => {
    const best = priorityScore({
      impact: "high",
      confidence: "high",
      effort: "low",
      valuePerMonth: 5000,
    });
    const worst = priorityScore({
      impact: "low",
      confidence: "low",
      effort: "high",
      valuePerMonth: 0,
    });
    expect(best).toBe(100);
    expect(best).toBeGreaterThan(worst);
    expect(worst).toBeGreaterThanOrEqual(1);
  });

  it("penalises effort", () => {
    const cheap = priorityScore({
      impact: "high",
      confidence: "high",
      effort: "low",
      valuePerMonth: 300,
    });
    const dear = priorityScore({
      impact: "high",
      confidence: "high",
      effort: "high",
      valuePerMonth: 300,
    });
    expect(cheap).toBeGreaterThan(dear);
  });
});

describe("effortHours", () => {
  it("maps effort level to an hour estimate", () => {
    expect(effortHours("low")).toBeLessThan(effortHours("high"));
  });
});
