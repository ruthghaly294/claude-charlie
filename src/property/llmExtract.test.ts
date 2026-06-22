import { describe, it, expect, vi } from "vitest";
import { createDb } from "@/db/client";
import { extractionCache } from "@/db/schema";
import {
  repairExtraction,
  repairExtractionCached,
  getExtractClient,
  type ExtractClient,
} from "./llmExtract";

function fakeClient(parsed: Record<string, unknown>) {
  const parse = vi.fn(async (..._args: unknown[]) => ({ parsed_output: parsed }));
  const client: ExtractClient = { messages: { parse } };
  return { client, parse };
}

const HTML = "<html><body><h1>3 Test Street</h1><p>Offers around £250,000</p></body></html>";

describe("repairExtraction", () => {
  it("returns null when no client is configured", async () => {
    const out = await repairExtraction(HTML, "https://x/property/a", {});
    expect(out).toBeNull();
  });

  it("returns fields parsed from the model when a client is configured", async () => {
    const { client, parse } = fakeClient({ askingPrice: 250000, postcode: "BT9 5FN" });
    const out = await repairExtraction(HTML, "https://x/property/a", { client });
    expect(out).toEqual({ askingPrice: 250000, postcode: "BT9 5FN" });
    expect(parse).toHaveBeenCalledTimes(1);
    const body = (parse.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(body.output_config).toBeDefined();
  });

  it("caps the page text sent to the model at ~6000 chars", async () => {
    const big = `<html><body>${"x".repeat(20000)}</body></html>`;
    const { client, parse } = fakeClient({});
    await repairExtraction(big, "https://x/property/a", { client });
    const body = (parse.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    const messages = body.messages as Array<{ content: string }>;
    expect(messages[0]!.content.length).toBeLessThan(6100);
  });
});

describe("getExtractClient", () => {
  it("returns null without an API key", () => {
    expect(getExtractClient({})).toBeNull();
  });

  it("returns null when DECODE_REASONER=deterministic even with a key", () => {
    expect(
      getExtractClient({ ANTHROPIC_API_KEY: "k", DECODE_REASONER: "deterministic" }),
    ).toBeNull();
  });

  it("returns a client when an API key is present", () => {
    expect(getExtractClient({ ANTHROPIC_API_KEY: "k" })).not.toBeNull();
  });
});

describe("repairExtractionCached", () => {
  it("calls the model once and caches the result by sha1(html)", async () => {
    const db = createDb(":memory:");
    const { client, parse } = fakeClient({ askingPrice: 300000 });

    const first = await repairExtractionCached(db, HTML, "https://x/property/a", {
      client,
      now: () => "2026-01-01T00:00:00.000Z",
    });
    expect(first).toEqual({ askingPrice: 300000 });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(db.select().from(extractionCache).all()).toHaveLength(1);

    // second call: no client at all, but the cache hit must short-circuit
    const second = await repairExtractionCached(db, HTML, "https://x/property/a", {});
    expect(second).toEqual({ askingPrice: 300000 });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("returns null without caching anything when no client is configured", async () => {
    const db = createDb(":memory:");
    const out = await repairExtractionCached(db, HTML, "https://x/property/a", {});
    expect(out).toBeNull();
    expect(db.select().from(extractionCache).all()).toHaveLength(0);
  });
});
