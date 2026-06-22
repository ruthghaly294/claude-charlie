import { describe, it, expect } from "vitest";
import { buildBulkComposeInputs } from "./bulkQueue";

const drafts = {
  x: { text: "x text\n\nhttps://example.com/post/1", hashtags: [], issues: [] },
  reddit: { text: "reddit text\n\nhttps://example.com/post/1", hashtags: [], issues: [] },
  instagram: {
    text: "ig text #ai\n\nhttps://example.com/post/1",
    hashtags: ["ai"],
    issues: ["Instagram posts need a cover image"],
  },
  facebook: { text: "fb text\n\nhttps://example.com/post/1", hashtags: [], issues: [] },
};

const provenance = {
  topic: "AI coding agents",
  itemUrl: "https://example.com/post/1",
  itemTitle: "Cursor hits 1M users",
  keyword: "AI coding agents",
};

describe("buildBulkComposeInputs", () => {
  it("produces one input per configured platform, in PLATFORMS order", () => {
    const inputs = buildBulkComposeInputs(
      drafts,
      { x: "chan-x", instagram: "chan-ig" },
      provenance,
    );
    expect(inputs.map((i) => i.platform)).toEqual(["x", "instagram"]);
  });

  it("omits platforms without a configured channel", () => {
    const inputs = buildBulkComposeInputs(drafts, { reddit: "chan-reddit" }, provenance);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ platform: "reddit", channelId: "chan-reddit" });
  });

  it("sets saveToDraft true exactly when issues is non-empty", () => {
    const inputs = buildBulkComposeInputs(
      drafts,
      { x: "chan-x", instagram: "chan-ig" },
      provenance,
    );
    const x = inputs.find((i) => i.platform === "x");
    const ig = inputs.find((i) => i.platform === "instagram");
    expect(x?.saveToDraft).toBe(false);
    expect(ig?.saveToDraft).toBe(true);
  });

  it("includes imageUrl when provided for that platform", () => {
    const inputs = buildBulkComposeInputs(drafts, { instagram: "chan-ig" }, provenance, {
      instagram: "https://example.com/cover.jpg",
    });
    expect(inputs[0]?.imageUrl).toBe("https://example.com/cover.jpg");
  });

  it("omits imageUrl when not provided for that platform", () => {
    const inputs = buildBulkComposeInputs(drafts, { x: "chan-x" }, provenance);
    expect(inputs[0]?.imageUrl).toBeUndefined();
  });

  it("threads provenance and post text through to every input", () => {
    const inputs = buildBulkComposeInputs(
      drafts,
      { x: "chan-x", reddit: "chan-reddit" },
      provenance,
    );
    for (const input of inputs) {
      expect(input.topic).toBe(provenance.topic);
      expect(input.itemUrl).toBe(provenance.itemUrl);
      expect(input.itemTitle).toBe(provenance.itemTitle);
      expect(input.keyword).toBe(provenance.keyword);
    }
    expect(inputs.find((i) => i.platform === "x")?.text).toBe(drafts.x.text);
    expect(inputs.find((i) => i.platform === "reddit")?.text).toBe(drafts.reddit.text);
  });

  it("returns an empty array when no platforms are configured", () => {
    expect(buildBulkComposeInputs(drafts, {}, provenance)).toEqual([]);
  });

  it("omits itemUrl from the input when provenance doesn't include one", () => {
    const { itemUrl, ...rest } = provenance;
    const inputs = buildBulkComposeInputs(drafts, { x: "chan-x" }, rest);
    expect(inputs[0]?.itemUrl).toBeUndefined();
    expect("itemUrl" in inputs[0]!).toBe(false);
  });
});
