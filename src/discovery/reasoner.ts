import type { Signal, Insight, Decision } from "@/db/schema";
import type { Lane } from "./config";

export type Importance = "high" | "medium" | "low";
export type Impact = "high" | "medium" | "low";
export type Effort = "high" | "medium" | "low";

export type ClusterSummary = {
  trend: string;
  body: string;
  importance: Importance;
};

export type DecisionProposal = {
  title: string;
  effort: Effort;
  confidence: Importance;
  /** expected revenue per month from acting on this, in dollars */
  valuePerMonth: number;
  rationale: string;
};

export type AssetDraft = {
  title: string;
  body: string;
};

/**
 * The reasoning seam for the OBSERVE → DECIDE → EXECUTE stages. The default
 * implementation below is deterministic (no LLM, no network) so every stage is
 * hermetically testable. An LLM-backed Reasoner (e.g. Vercel AI SDK) can be
 * dropped in later via the `reasoner` option on each stage without changing
 * any stage logic.
 */
export interface Reasoner {
  /** OBSERVE: distill a cluster of signals into one insight. */
  summarizeCluster(
    cluster: string,
    signals: Signal[],
  ): ClusterSummary | Promise<ClusterSummary>;
  /** DECIDE: turn an insight into a recommendation for a given lane. */
  proposeDecision(
    insight: Insight,
    lane: Lane,
  ): DecisionProposal | Promise<DecisionProposal>;
  /** EXECUTE: draft the asset for a top decision. */
  draftAsset(decision: Decision): AssetDraft | Promise<AssetDraft>;
}

/** Lanes that imply building something substantial cost more effort. */
const HIGH_EFFORT_LANES = new Set<Lane>(["product", "strategic"]);

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export const deterministicReasoner: Reasoner = {
  summarizeCluster(cluster, signals) {
    const n = signals.length;
    const avgScore = avg(signals.map((s) => s.score ?? 0));
    const top = [...signals]
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 3);

    const importance: Importance =
      n >= 3 || avgScore >= 0.7
        ? "high"
        : n <= 1 && avgScore < 0.4
          ? "low"
          : "medium";

    const trend = `${cluster}: ${n} signal${n === 1 ? "" : "s"} trending (avg score ${avgScore.toFixed(2)})`;

    const body = [
      `**What changed:** ${n} signal${n === 1 ? "" : "s"} clustered around "${cluster}".`,
      `**Why it matters:** sustained activity (avg score ${avgScore.toFixed(2)}) suggests rising interest worth a response.`,
      `**Monetizable angle:** package the "${cluster}" trend into a paid digital product — a research brief, a premium newsletter section, or a tracked dashboard.`,
      `**Recommended action:** review the ${cluster} cluster and ship a sellable asset before the interest peaks.`,
      "",
      "Top signals:",
      ...top.map((s) => `- ${s.title}`),
    ].join("\n");

    return { trend, body, importance };
  },

  proposeDecision(insight, lane) {
    const cluster = insight.cluster;
    const titleByLane: Record<Lane, string> = {
      product: `Build a ${cluster} feature`,
      content: `Publish content on ${cluster}`,
      marketing: `Launch a ${cluster} campaign`,
      strategic: `Form a ${cluster} strategy`,
    };
    const effort: Effort = HIGH_EFFORT_LANES.has(lane) ? "high" : "low";
    const monetizeByLane: Record<Lane, string> = {
      product: `Charge for a ${cluster} tool or template.`,
      content: `Sell a ${cluster} brief or paid newsletter issue.`,
      marketing: `Run a ${cluster} campaign that drives paid signups.`,
      strategic: `Offer a ${cluster} strategy brief as a paid consult deliverable.`,
    };
    const valueByLane: Record<Lane, number> = {
      product: 800,
      content: 300,
      marketing: 500,
      strategic: 1000,
    };
    const rationale = `Derived from insight "${insight.trend}" (importance: ${insight.importance}).\n\nMonetization: ${monetizeByLane[lane]}`;
    return {
      title: titleByLane[lane],
      effort,
      confidence: insight.importance,
      valuePerMonth: valueByLane[lane],
      rationale,
    };
  },

  draftAsset(decision) {
    const { lane, title, rationale } = decision;
    const bodyByLane: Record<Lane, string> = {
      content: [
        `# ${title}`,
        "",
        "## Outline",
        "1. Hook — why this matters now",
        "2. The trend and the evidence",
        "3. What it means for the reader",
        "4. Call to action",
        "",
        `> ${rationale}`,
      ].join("\n"),
      marketing: [
        `# ${title}`,
        "",
        "## Landing copy",
        "**Headline:** <one-line promise>",
        "**Subhead:** <supporting detail>",
        "**CTA:** <primary action>",
        "",
        `> ${rationale}`,
      ].join("\n"),
      product: [
        `# ${title}`,
        "",
        "## Spec",
        "**Problem:** <user problem>",
        "**User stories:**",
        "- As a user, I want …",
        "**Success metric:** <what to measure>",
        "",
        `> ${rationale}`,
      ].join("\n"),
      strategic: [
        `# ${title}`,
        "",
        "## One-page brief",
        "**Situation:** <context>",
        "**Recommendation:** <the move>",
        "**Risks:** <what could go wrong>",
        "",
        `> ${rationale}`,
      ].join("\n"),
    };
    return { title, body: bodyByLane[lane] };
  },
};
