import { describe, it, expect, vi } from "vitest";
import {
  cosineSimilarity,
  makeOpenRouterEmbedder,
  getEmbedder,
  semanticScores,
} from "./embeddings";

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors and 0 for orthogonal", () => {
    expect(cosineSimilarity([1, 1], [1, 1])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
  it("is 0 for empty or mismatched-length vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
  });
});

function embedResponse(vectors: number[][]) {
  return new Response(JSON.stringify({ data: vectors.map((embedding) => ({ embedding })) }), {
    status: 200,
  });
}

describe("makeOpenRouterEmbedder", () => {
  it("posts input to /embeddings with the key and returns vectors", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => embedResponse([[1, 0], [0, 1]]),
    );
    const embed = makeOpenRouterEmbedder({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await embed(["a", "b"]);
    expect(out).toEqual([[1, 0], [0, 1]]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("/embeddings");
    expect(init!.headers).toMatchObject({ authorization: "Bearer k" });
  });

  it("returns [] without calling fetch for empty input", async () => {
    const fetchImpl = vi.fn();
    const embed = makeOpenRouterEmbedder({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await embed([])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("getEmbedder", () => {
  it("prefers the dedicated embed key, falls back to the pool, and is null with neither", () => {
    expect(getEmbedder({ OPENROUTER_EMBED_API_KEY: "e" })).not.toBeNull();
    expect(getEmbedder({ OPENROUTER_API_KEYS: "a,b" })).not.toBeNull();
    expect(getEmbedder({})).toBeNull();
  });
});

describe("semanticScores", () => {
  it("scores each item by cosine vs the query and clamps negatives to 0", async () => {
    // query=[1,0]; item A=[1,0] (sim 1), item B=[-1,0] (sim -1 → 0)
    const embedder = vi.fn(async () => [[1, 0], [1, 0], [-1, 0]]);
    const scores = await semanticScores(
      "q",
      [
        { key: "A", text: "on topic" },
        { key: "B", text: "opposite" },
      ],
      embedder,
    );
    expect(scores.A).toBeCloseTo(1);
    expect(scores.B).toBe(0);
  });

  it("returns {} when the embedder throws (graceful degradation)", async () => {
    const embedder = vi.fn(async () => {
      throw new Error("no embeddings access");
    });
    expect(await semanticScores("q", [{ key: "A", text: "x" }], embedder)).toEqual({});
  });
});
