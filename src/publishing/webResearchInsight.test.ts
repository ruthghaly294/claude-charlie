import { describe, it, expect, vi } from "vitest";
import { makeWebResearchInsight, getWebResearchInsight } from "./webResearchInsight";
import type { ScrapedSource } from "@/research/contentExtract";
import type { PostGenClient } from "./postGenerator";
import type { DecodeConfig } from "@/discovery/config";

function client(content: string): { client: PostGenClient; complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn(async () => ({ content, usage: { prompt_tokens: 100, completion_tokens: 40 } }));
  return { client: { complete } as unknown as PostGenClient, complete };
}

const sources: ScrapedSource[] = [
  { url: "https://oilnews.com/a", title: "Oil dip", text: "Brent fell to $86, a 14% monthly drop, on the US-Iran roadmap." },
  { url: "https://econ.org/b", text: "Inventories are tightening despite the price fall." },
];

describe("makeWebResearchInsight", () => {
  it("scrapes, distills, and returns the insight grounded in the source URLs", async () => {
    const { client: c, complete } = client("Counterintuitive: prices fell even as supply tightened — $86 Brent.");
    const scrape = vi.fn(async () => sources);
    const provider = makeWebResearchInsight({ client: c, scrape });

    const out = await provider.distill("us oil drops", [{ url: "https://oilnews.com/a" }, { url: "https://econ.org/b" }]);

    expect(out).not.toBeNull();
    expect(out!.text).toContain("$86 Brent");
    expect(out!.citations).toEqual(["https://oilnews.com/a", "https://econ.org/b"]);
    // the model saw the scraped bodies
    const user = (complete.mock.calls[0]![0] as { messages: { role: string; content: string }[] }).messages[1]!.content;
    expect(user).toContain("Brent fell to $86");
  });

  it("returns null when nothing could be scraped", async () => {
    const { client: c } = client("unused");
    const provider = makeWebResearchInsight({ client: c, scrape: vi.fn(async () => []) });
    expect(await provider.distill("t", [{ url: "https://x/y" }])).toBeNull();
  });

  it("returns null when the model yields empty text", async () => {
    const { client: c } = client("   ");
    const provider = makeWebResearchInsight({ client: c, scrape: vi.fn(async () => sources) });
    expect(await provider.distill("t", [{ url: "https://x/y" }])).toBeNull();
  });
});

describe("getWebResearchInsight", () => {
  const config = { research: { topN: 5 }, profile: { voice: "" } } as unknown as DecodeConfig;

  it("is undefined without OpenRouter keys or in deterministic mode", () => {
    expect(getWebResearchInsight(config, {})).toBeUndefined();
    expect(getWebResearchInsight(config, { OPENROUTER_API_KEY: "k", DECODE_REASONER: "deterministic" })).toBeUndefined();
  });

  it("is defined when a key is present", () => {
    expect(getWebResearchInsight(config, { OPENROUTER_API_KEY: "k" })).toBeDefined();
  });
});
