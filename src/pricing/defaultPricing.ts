/**
 * Built-in pricing data for GitHub Copilot models.
 * Prices are per 1 million tokens in USD (credits ÷ 100, since 1 credit = $0.01).
 * Source: GitHub Docs "Models and pricing for GitHub Copilot", June 3, 2026
 * Effective: June 3, 2026
 */
export interface ModelPricing {
  input: number;
  cached: number;
  cacheWrite?: number; // Anthropic prompt-caching write cost (if applicable)
  output: number;
}

export interface PricingData {
  version: string;
  effectiveDate: string;
  models: Record<string, ModelPricing>;
}

export const DEFAULT_PRICING: PricingData = {
  version: "2026-06-03",
  effectiveDate: "2026-06-03",
  models: {
    // OpenAI — USD: In/Cache/Out per 1M tokens
    "gpt-4.1":       { input: 2, cached: 0.5, output: 8 },
    "gpt-5-mini":    { input: 0.25, cached: 0.025, output: 2 },
    "gpt-5.2":       { input: 1.75, cached: 0.175, output: 14 },
    "gpt-5.2-codex": { input: 1.75, cached: 0.175, output: 14 },
    "gpt-5.3-codex": { input: 1.75, cached: 0.175, output: 14 },
    "gpt-5.4":       { input: 2.5, cached: 0.25, output: 15 },
    "gpt-5.4-mini":  { input: 0.75, cached: 0.075, output: 4.5 },
    "gpt-5.4-nano":  { input: 0.2, cached: 0.02, output: 1.25 },
    "gpt-5.5":       { input: 5, cached: 0.5, output: 30 },

    // Anthropic — USD: In/Cache/Cache Write/Out per 1M tokens
    "claude-haiku-4.5":  { input: 1, cached: 0.1, cacheWrite: 1.25, output: 5 },
    "claude-sonnet-4":   { input: 3, cached: 0.3, cacheWrite: 3.75, output: 15 },
    "claude-sonnet-4.5": { input: 3, cached: 0.3, cacheWrite: 3.75, output: 15 },
    "claude-sonnet-4.6": { input: 3, cached: 0.3, cacheWrite: 3.75, output: 15 },
    "claude-opus-4.5":   { input: 5, cached: 0.5, cacheWrite: 6.25, output: 25 },
    "claude-opus-4.6":   { input: 5, cached: 0.5, cacheWrite: 6.25, output: 25 },
    "claude-opus-4.7":   { input: 5, cached: 0.5, cacheWrite: 6.25, output: 25 },
    "claude-opus-4.8":   { input: 5, cached: 0.5, cacheWrite: 6.25, output: 25 },

    // Google — USD: In/Cache/Out per 1M tokens
    "gemini-2.5-pro":   { input: 1.25, cached: 0.125, output: 10 },
    "gemini-3-flash":   { input: 0.5, cached: 0.05, output: 3 },
    "gemini-3.1-pro":   { input: 2, cached: 0.2, output: 12 },
    "gemini-3.5-flash": { input: 1.5, cached: 0.15, output: 9 },

    // GitHub / Microsoft — USD: In/Cache/Out per 1M tokens
    "raptor-mini":      { input: 0.25, cached: 0.025, output: 2 },
    "mai-code-1-flash": { input: 0.75, cached: 0.075, output: 4.5 },
  },
};
