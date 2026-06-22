/**
 * Text embeddings via OpenRouter's OpenAI-compatible `/embeddings` endpoint,
 * used for semantic relevance reranking. Best-effort: when no embedding key is
 * configured `getEmbedder` returns null and callers fall back to keyword
 * scoring, so this never becomes a hard dependency.
 *
 * Key resolution prefers a dedicated `OPENROUTER_EMBED_API_KEY` (chat-only
 * stealth models like owl-alpha don't serve embeddings), then the first key in
 * the standard pool. Model defaults to a small, cheap embedding model.
 */
import { parseOpenRouterKeys } from "./openRouterPool";

export type Embedder = (texts: string[]) => Promise<number[][]>;

const DEFAULT_MODEL = "openai/text-embedding-3-small";

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export type OpenRouterEmbedderOptions = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export function makeOpenRouterEmbedder(opts: OpenRouterEmbedderOptions): Embedder {
  const model = opts.model ?? DEFAULT_MODEL;
  const baseUrl = opts.baseUrl ?? "https://openrouter.ai/api/v1";
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async (texts) => {
    if (texts.length === 0) return [];
    const res = await fetchImpl(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({ model, input: texts }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenRouter embeddings failed (${res.status})${detail ? `: ${detail}` : ""}`);
    }
    const json = (await res.json()) as { data?: { embedding?: number[] }[] };
    return (json.data ?? []).map((d) => d.embedding ?? []);
  };
}

/** Build an embedder from the environment, or null when no key is available. */
export function getEmbedder(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Embedder | null {
  const apiKey = env.OPENROUTER_EMBED_API_KEY ?? parseOpenRouterKeys(env)[0];
  if (!apiKey) return null;
  return makeOpenRouterEmbedder({
    apiKey,
    model: env.OPENROUTER_EMBED_MODEL,
    baseUrl: env.OPENROUTER_BASE_URL,
    fetchImpl,
  });
}

/**
 * Cosine similarity of `query` against each item's text, returned as a map from
 * the item key to a [0,1] score (negative cosines clamp to 0). One batch call.
 * Returns an empty map on any failure so the caller degrades gracefully.
 */
export async function semanticScores(
  query: string,
  items: { key: string; text: string }[],
  embedder: Embedder,
): Promise<Record<string, number>> {
  if (items.length === 0) return {};
  try {
    const vectors = await embedder([query, ...items.map((i) => i.text)]);
    const queryVec = vectors[0];
    if (!queryVec) return {};
    const out: Record<string, number> = {};
    items.forEach((item, i) => {
      const vec = vectors[i + 1];
      if (vec) out[item.key] = Math.max(0, cosineSimilarity(queryVec, vec));
    });
    return out;
  } catch {
    return {};
  }
}
