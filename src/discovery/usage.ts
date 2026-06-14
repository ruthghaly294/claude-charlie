export type Usage = { inputTokens: number; outputTokens: number };

/** Per-1M-token pricing (USD). Source: Anthropic + OpenRouter pricing, input/output. */
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-opus-4-7": { in: 5, out: 25 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "deepseek/deepseek-v4-pro": { in: 0.5, out: 1.5 },
};

const DEFAULT_PRICE = { in: 5, out: 25 };

export function priceUsd(model: string, usage: Usage): number {
  const p = PRICING[model] ?? DEFAULT_PRICE;
  return (
    (usage.inputTokens * p.in + usage.outputTokens * p.out) / 1_000_000
  );
}

/**
 * Accumulates token usage and cost across the many LLM calls in one DECODE run,
 * so the loop can report exactly where tokens (and dollars) went.
 */
export class UsageMeter {
  inputTokens = 0;
  outputTokens = 0;
  costUsd = 0;

  record(model: string, usage: Usage): void {
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    this.costUsd += priceUsd(model, usage);
  }

  get totals() {
    return {
      tokensIn: this.inputTokens,
      tokensOut: this.outputTokens,
      costUsd: Math.round(this.costUsd * 10000) / 10000,
    };
  }
}
