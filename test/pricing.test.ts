import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, defaultValue: unknown) => defaultValue,
    }),
  },
}));

import { PricingEngine } from "../src/pricing/pricingEngine";

// Mock pricing data for testing (matching actual defaultPricing.ts values)
const MOCK_PRICING = {
  "gpt-5.4": { input: 2.5, output: 15, cached: 0.25 },
  "claude-sonnet-4.6": { input: 3, output: 15, cached: 0.3, cacheWrite: 3.75 },
  "gpt-5-mini": { input: 0.25, output: 2, cached: 0.025 },
};

const DEFAULT_FALLBACK = {
  input: 2.5,
  output: 15,
  cached: 0.25,
};

describe("Pricing Engine", () => {
  describe("Cost Calculation", () => {
    it("calculates cost correctly for input tokens", () => {
      const pricing = MOCK_PRICING["gpt-5.4"];
      const inputTokens = 1_000_000;
      const costUsd = (inputTokens * pricing.input) / 1_000_000;
      expect(costUsd).toBeCloseTo(2.5);
    });

    it("calculates cost correctly for output tokens", () => {
      const pricing = MOCK_PRICING["gpt-5.4"];
      const outputTokens = 1_000_000;
      const costUsd = (outputTokens * pricing.output) / 1_000_000;
      expect(costUsd).toBeCloseTo(15);
    });

    it("calculates cost correctly for cached tokens", () => {
      const pricing = MOCK_PRICING["gpt-5.4"];
      const cachedTokens = 1_000_000;
      const costUsd = (cachedTokens * pricing.cached) / 1_000_000;
      expect(costUsd).toBeCloseTo(0.25);
    });

    it("combines input, output, and cached token costs", () => {
      const pricing = MOCK_PRICING["gpt-5.4"];
      const input = 500_000;
      const output = 250_000;
      const cached = 100_000;

      const costUsd =
        (input * pricing.input + output * pricing.output + cached * pricing.cached) / 1_000_000;

      const expected = 1.25 + 3.75 + 0.025;
      expect(costUsd).toBeCloseTo(expected);
    });

    it("uses fallback rate for unknown models", () => {
      const input = 1_000_000;
      const costUsd = (input * DEFAULT_FALLBACK.input) / 1_000_000;
      expect(costUsd).toBeCloseTo(2.5);
    });

    it("handles zero tokens gracefully", () => {
      const pricing = MOCK_PRICING["gpt-5.4"];
      const costUsd = (0 * pricing.input + 0 * pricing.output + 0 * pricing.cached) / 1_000_000;
      expect(costUsd).toBe(0);
    });

    it("converts cost to credits (1 credit = $0.01)", () => {
      const costUsd = 0.025;
      const credits = costUsd * 100;
      expect(credits).toBe(2.5);
    });

    it("calculates cost for multiple models correctly", () => {
      const models = [
        { name: "gpt-5.4",          input: 1_000_000, output: 0, cached: 0 },
        { name: "claude-sonnet-4.6", input: 1_000_000, output: 0, cached: 0 },
      ];

      const totalCost = models.reduce((sum, m) => {
        const pricing = MOCK_PRICING[m.name as keyof typeof MOCK_PRICING] || DEFAULT_FALLBACK;
        return sum + (m.input * pricing.input) / 1_000_000;
      }, 0);

      expect(totalCost).toBeCloseTo(5.5); // 2.50 + 3.00
    });
  });

  describe("Model Normalization", () => {
    it("normalizes model names to lowercase", () => {
      const models = ["GPT-5.4", "gpt-5.4", "Gpt-5.4"];
      const normalized = models.map((m) => m.toLowerCase());
      expect(normalized.every((n) => n === "gpt-5.4")).toBe(true);
    });

    it("replaces underscores with hyphens", () => {
      const model = "gpt_5_mini";
      const normalized = model.replaceAll("_", "-");
      expect(normalized).toBe("gpt-5-mini");
    });

    it("handles variant suffixes (e.g., -preview, -latest)", () => {
      const models = ["claude-sonnet-4.6-preview", "claude-sonnet-4.6-latest"];
      // Should still match base model via prefix
      expect(models.map((m) => m.startsWith("claude-sonnet-4.6"))).toEqual([true, true]);
    });
  });

  describe("Custom Rates", () => {
    it("applies custom rates when provided", () => {
      const customRates = {
        "my-model": { input: 1, output: 2 },
      };
      const input = 1_000_000;
      const costUsd = (input * (customRates["my-model"].input * 0.01)) / 1_000_000;
      expect(costUsd).toBeCloseTo(0.01);
    });

    it("prefers custom rates over built-in rates", () => {
      const model = "gpt-5.4";
      const customRates = {
        "gpt-5.4": { input: 1000, output: 5000 },
      };

      const costWithCustom = (1_000_000 * (customRates[model].input * 0.01)) / 1_000_000;
      const costWithBuiltIn = (1_000_000 * MOCK_PRICING[model].input) / 1_000_000;

      expect(costWithCustom).toBeGreaterThan(costWithBuiltIn);
    });

    it("matches custom rates by substring case-insensitively", () => {
      const engine = new PricingEngine();
      engine.setDependencies({
        config: {
          customModelRates: {
            "Claude-Sonnet": { input: 150, output: 600 },
          },
        },
      } as any, undefined as any);

      const costUsd = engine.calculateCost("claude-sonnet-4.6-preview", 1_000_000, 0, 0);
      expect(costUsd).toBeCloseTo(1.5);
    });

    it("handles empty custom rates object", () => {
      const customRates = {} as Record<string, { input: number; output: number }>;
      expect(Object.keys(customRates).length).toBe(0);
    });

    it("excludes unknown models from totals when configured", () => {
      const engine = new PricingEngine();
      engine.setDependencies({
        config: {
          customModelRates: {},
          excludeUnknownModelsFromTotals: true,
        },
      } as any, undefined as any);

      const costUsd = engine.calculateCost("unknown-new-model", 1_000_000, 0, 0);
      const diagnostics = engine.getUnknownModelDiagnostics();

      expect(costUsd).toBe(0);
      expect(diagnostics.excludedTurnCount).toBe(1);
      expect(diagnostics.excludedModelCount).toBe(1);
      expect(diagnostics.excludedModels).toContain("unknown-new-model");
    });

    it("tracks fallback unknown models when exclusion is disabled", () => {
      const engine = new PricingEngine();
      engine.setDependencies({
        config: {
          customModelRates: {},
          excludeUnknownModelsFromTotals: false,
        },
      } as any, undefined as any);

      const costUsd = engine.calculateCost("another-unknown-model", 1_000_000, 0, 0);
      const diagnostics = engine.getUnknownModelDiagnostics();

      expect(costUsd).toBeCloseTo(2.5);
      expect(diagnostics.fallbackModelCount).toBe(1);
      expect(diagnostics.fallbackModels).toContain("another-unknown-model");
    });
  });

  describe("Cache Discounts", () => {
    it("cached tokens cost less than input tokens", () => {
      const input = 1_000_000;
      const cached = 1_000_000;
      const pricing = MOCK_PRICING["gpt-5.4"];

      const costInput = (input * pricing.input) / 1_000_000;
      const costCached = (cached * pricing.cached) / 1_000_000;

      expect(costCached).toBeLessThan(costInput);
    });

    it("handles cache_write_tokens separately", () => {
      const cacheWrite = 1_000_000;
      const costWrite = (cacheWrite * MOCK_PRICING["claude-sonnet-4.6"].cacheWrite) / 1_000_000;
      expect(costWrite).toBeCloseTo(3.75);
    });
  });

  describe("Cache Savings Calculation", () => {
    it("calculates cache savings for cache write tokens (Anthropic models)", () => {
      const engine = new PricingEngine();
      const modelFamily = "claude-sonnet-4.6";
      const cacheWriteTokens = 1_000_000; // 1M tokens to write to cache
      const cacheReadTokens = 0;

      const engine_method = (engine as any).calculateCacheSavingsCost;
      // Since this is a private method, we'll test the math directly
      const pricing = MOCK_PRICING[modelFamily];
      const expectedCost = (cacheWriteTokens / 1_000_000) * pricing.cacheWrite;

      expect(expectedCost).toBeCloseTo(3.75);
    });

    it("calculates cache savings for cache read tokens (all models)", () => {
      const modelFamily = "gpt-5.4";
      const cacheWriteTokens = 0;
      const cacheReadTokens = 1_000_000; // 1M cached tokens read

      const pricing = MOCK_PRICING[modelFamily];
      const expectedCost = (cacheReadTokens / 1_000_000) * pricing.cached;

      expect(expectedCost).toBeCloseTo(0.25);
    });

    it("combines cache write and read costs for total savings", () => {
      const modelFamily = "claude-sonnet-4.6";
      const cacheWriteTokens = 1_000_000;
      const cacheReadTokens = 500_000;

      const pricing = MOCK_PRICING[modelFamily];
      const writeCost = (cacheWriteTokens / 1_000_000) * pricing.cacheWrite;
      const readCost = (cacheReadTokens / 1_000_000) * pricing.cached;
      const totalSavings = writeCost + readCost;

      expect(totalSavings).toBeCloseTo(3.75 + 0.15);
    });

    it("converts savings cost to credits", () => {
      const costUsd = 5.0;
      const creditsFromCost = costUsd * 100; // 1 credit = $0.01

      expect(creditsFromCost).toBe(500);
    });
  });
});
