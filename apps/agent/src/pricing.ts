import type Anthropic from "@anthropic-ai/sdk";

/** USD per million tokens. Cache writes (5-minute TTL) cost 1.25x input. */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

const PRICES: Record<string, Price> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

const FALLBACK_PRICE = PRICES["claude-opus-5-5"]!;

export interface TokenTotals {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

export function emptyTotals(): TokenTotals {
  return { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
}

export function addUsage(totals: TokenTotals, usage: Anthropic.Beta.BetaUsage): TokenTotals {
  return {
    input: totals.input + usage.input_tokens,
    cacheWrite: totals.cacheWrite + (usage.cache_creation_input_tokens ?? 0),
    cacheRead: totals.cacheRead + (usage.cache_read_input_tokens ?? 0),
    output: totals.output + usage.output_tokens,
  };
}

/** Cost of one response in USD, priced by the model that actually served it. */
export function costUsd(model: string, usage: Anthropic.Beta.BetaUsage): number {
  const price = PRICES[model] ?? FALLBACK_PRICE;
  return (
    (usage.input_tokens * price.input +
      (usage.cache_creation_input_tokens ?? 0) * price.input * 1.25 +
      (usage.cache_read_input_tokens ?? 0) * price.cacheRead +
      usage.output_tokens * price.output) /
    1_000_000
  );
}

export function usdToInr(usd: number): number {
  const rate = Number(process.env.USD_TO_INR ?? 84);
  return Math.round(usd * rate * 10_000) / 10_000;
}
