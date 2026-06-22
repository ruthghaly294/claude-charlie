import { describe, it, expect } from "vitest";
import { validatePost } from "./validate";

const URL = "https://example.com/post/1";

describe("validatePost", () => {
  it("flags x posts over the 280 character limit", () => {
    const text = `${"a".repeat(290)} ${URL}`;
    const issues = validatePost("x", { text, hashtags: [] }, { url: URL });
    expect(issues).toEqual([expect.stringContaining("280")]);
  });

  it("flags x posts with more than 2 hashtags", () => {
    const text = `hello ${URL}`;
    const issues = validatePost("x", { text, hashtags: ["a", "b", "c"] }, { url: URL });
    expect(issues).toEqual([expect.stringContaining("hashtag")]);
  });

  it("flags reddit posts that use hashtags", () => {
    const text = `hello ${URL}`;
    const issues = validatePost("reddit", { text, hashtags: ["a"] }, { url: URL });
    expect(issues).toEqual([expect.stringMatching(/hashtag/i)]);
  });

  it("flags instagram posts without a cover image", () => {
    const text = `hello ${URL}`;
    const issues = validatePost(
      "instagram",
      { text, hashtags: ["a"] },
      { url: URL, hasImage: false },
    );
    expect(issues).toEqual([expect.stringContaining("cover image")]);
  });

  it("flags instagram posts with no hashtags", () => {
    const text = `hello ${URL}`;
    const issues = validatePost(
      "instagram",
      { text, hashtags: [] },
      { url: URL, hasImage: true },
    );
    expect(issues).toEqual([expect.stringContaining("hashtag")]);
  });

  it("flags facebook posts with more than 2 hashtags", () => {
    const text = `hello ${URL}`;
    const issues = validatePost("facebook", { text, hashtags: ["a", "b", "c"] }, { url: URL });
    expect(issues).toEqual([expect.stringContaining("hashtag")]);
  });

  it("flags any post missing the source link", () => {
    const issues = validatePost("x", { text: "hello there", hashtags: [] }, { url: URL });
    expect(issues).toEqual([expect.stringContaining("source link")]);
  });

  it("returns no issues for a clean post", () => {
    const text = `hello ${URL}`;
    const issues = validatePost("x", { text, hashtags: ["a"] }, { url: URL });
    expect(issues).toEqual([]);
  });
});
