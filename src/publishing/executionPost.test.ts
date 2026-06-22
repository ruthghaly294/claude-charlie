import { describe, it, expect } from "vitest";
import { PLATFORMS } from "./postGenerator";
import { validatePost } from "./validate";
import { draftsFromExecution, assetPromptFromExecution } from "./executionPost";

const exec = {
  title: "Why congressional trade disclosures move markets",
  body: "A deep dive into how 13F filings and disclosed trades from members of congress correlate with short-term price moves, with a framework for tracking them. ".repeat(
    5,
  ),
  lane: "content",
};

describe("draftsFromExecution", () => {
  it("returns a draft for every platform with text and hashtags", () => {
    const drafts = draftsFromExecution(exec);
    for (const p of PLATFORMS) {
      expect(drafts[p].text.length).toBeGreaterThan(0);
      expect(Array.isArray(drafts[p].hashtags)).toBe(true);
    }
  });

  it("keeps the x draft within the 280 character limit and includes the title", () => {
    const drafts = draftsFromExecution(exec);
    expect(drafts.x.text.length).toBeLessThanOrEqual(280);
    expect(drafts.x.text).toContain(exec.title);
  });

  it("has no hashtags for x, reddit, and facebook", () => {
    const drafts = draftsFromExecution(exec);
    expect(drafts.x.hashtags).toEqual([]);
    expect(drafts.reddit.hashtags).toEqual([]);
    expect(drafts.facebook.hashtags).toEqual([]);
  });

  it("derives at least one instagram hashtag even when the title has no long words", () => {
    const drafts = draftsFromExecution({ title: "AI", body: "short", lane: "content" });
    expect(drafts.instagram.hashtags.length).toBeGreaterThan(0);
  });

  it("derives instagram hashtags from the title", () => {
    const drafts = draftsFromExecution(exec);
    expect(drafts.instagram.hashtags.length).toBeGreaterThan(0);
    expect(drafts.instagram.text).toContain(`#${drafts.instagram.hashtags[0]}`);
  });

  it("dedupes hashtag candidates, excludes words of 3 chars or fewer, and caps at 5", () => {
    const drafts = draftsFromExecution({
      title: "data data data analytics insights metrics trends reports growth and the",
      body: "short",
      lane: "content",
    });
    const tags = drafts.instagram.hashtags;
    expect(tags).toHaveLength(5);
    expect(tags.filter((t) => t === "data")).toHaveLength(1);
    expect(tags).not.toContain("and");
    expect(tags).not.toContain("the");
  });
});

describe("draftsFromExecution + validatePost (no source URL)", () => {
  const drafts = draftsFromExecution(exec);

  it("raises no issues for x, reddit, and facebook", () => {
    for (const p of ["x", "reddit", "facebook"] as const) {
      expect(validatePost(p, drafts[p], { url: "", hasImage: false })).toEqual([]);
    }
  });

  it("flags only the missing cover image for instagram without an asset", () => {
    const issues = validatePost("instagram", drafts.instagram, { url: "", hasImage: false });
    expect(issues).toEqual(["Instagram posts need a cover image"]);
  });

  it("raises no issues for instagram once an asset is generated", () => {
    expect(validatePost("instagram", drafts.instagram, { url: "", hasImage: true })).toEqual([]);
  });
});

describe("assetPromptFromExecution", () => {
  it("builds a non-empty prompt mentioning the execution title", () => {
    const prompt = assetPromptFromExecution(exec);
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain(exec.title);
  });
});
