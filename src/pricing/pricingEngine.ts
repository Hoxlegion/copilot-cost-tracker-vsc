import * as vscode from "vscode";
import { DEFAULT_PRICING, ModelPricing, PricingData } from "./defaultPricing";
import { ConfigManager, ModelRate } from "../config";
import { Logger } from "../logger";

// Built-in fallback rate for truly unknown models (GPT-5.4 tier, 250/25/1500 credits/1M)
const DEFAULT_FALLBACK_RATE: ModelPricing = {
  input: 2.5,  // 250 credits/1M → $2.50 USD
  output: 15,  // 1500 credits/1M → $15.00 USD
  cached: 0.25, // 25 credits/1M → $0.25 USD
};

export interface UnknownModelDiagnostics {
  fallbackModelCount: number;
  fallbackModels: string[];
  excludedTurnCount: number;
  excludedModelCount: number;
  excludedModels: string[];
}

export class PricingEngine {
  private pricing: PricingData = DEFAULT_PRICING;
  private lastFetch: number = 0;
  private readonly FETCH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private configManager: ConfigManager | undefined;
  private logger: Logger | undefined;
  private readonly warnedModels: Set<string> = new Set();
  private readonly unknownFallbackModels: Set<string> = new Set();
  private readonly unknownExcludedModels: Set<string> = new Set();
  private unknownExcludedTurnCount: number = 0;

  /**
   * Set dependencies (called after construction to avoid circular deps).
   */
  setDependencies(configManager: ConfigManager, logger: Logger): void {
    this.configManager = configManager;
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    await this.refreshPricing();
  }

  async refreshPricing(): Promise<void> {
    // 1. Fetch from user-configured remote URL, cached for 24 hours.
    const url = this.configManager?.config.pricingUrl
      ?? vscode.workspace.getConfiguration("copilotCostTracker").get<string>("pricingUrl", "");

    if (url && Date.now() - this.lastFetch > this.FETCH_INTERVAL_MS) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const remote = (await response.json()) as PricingData;
          if (remote.models && remote.version) {
            this.pricing = remote;
            this.lastFetch = Date.now();
            this.logger?.debug("Pricing updated from remote URL");
            return;
          }
        }
      } catch (err) {
        // Network failure or invalid response; fall through to built-in table
        this.logger?.warn("Failed to fetch remote pricing; using built-in pricing", err);
      }
    }

    // 2. Fall back to built-in table (updated manually from GitHub Docs on each release).
    if (!this.lastFetch) {
      this.pricing = DEFAULT_PRICING;
      this.logger?.debug("Using built-in pricing table");
    }
  }

  getModelPricing(modelFamily: string): ModelPricing | undefined {
    const normalized = this.normalizeModelName(modelFamily);
    return this.pricing.models[normalized];
  }

  /**
  * Calculate cost in USD for a given token usage.
  * Uses custom rates for unknown models, with a built-in GPT-5.4 tier as final fallback.
   */
  calculateCost(
    modelFamily: string,
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number,
    cacheWriteTokens: number = 0
  ): number {
    let pricing = this.getModelPricing(modelFamily);

    if (!pricing) {
      // Check custom model rates from config (D11)
      pricing = this.getCustomRate(modelFamily);

      if (!pricing) {
        if (this.shouldExcludeUnknownModels()) {
          this.unknownExcludedTurnCount++;
          this.unknownExcludedModels.add(modelFamily);
          if (!this.warnedModels.has(modelFamily)) {
            this.warnedModels.add(modelFamily);
            this.logger?.warn(
              `Unknown model "${modelFamily}" — excluded from totals due to ` +
              `copilotCostTracker.excludeUnknownModelsFromTotals=true. ` +
              `Configure custom rates in copilotCostTracker.customModelRates to include it.`
            );
          }
          return 0;
        }

        // Use built-in fallback and warn (once per model)
        pricing = DEFAULT_FALLBACK_RATE;
        this.unknownFallbackModels.add(modelFamily);
        if (!this.warnedModels.has(modelFamily)) {
          this.warnedModels.add(modelFamily);
          this.logger?.warn(
            `Unknown model "${modelFamily}" — using fallback rate (GPT-5.4 tier). ` +
            `Configure custom rates in copilotCostTracker.customModelRates to override.`
          );
        }
      }
    }

    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    const cachedCost = (cachedTokens / 1_000_000) * pricing.cached;
    const cacheWriteCost = pricing.cacheWrite
      ? (cacheWriteTokens / 1_000_000) * pricing.cacheWrite
      : 0;

    return inputCost + outputCost + cachedCost + cacheWriteCost;
  }

  /**
   * Look up a custom rate from the config's customModelRates map.
   * Matches case-insensitively using exact or substring keys, as documented in settings.
   */
  private getCustomRate(modelFamily: string): ModelPricing | undefined {
    if (!this.configManager) { return undefined; }

    const customRates = this.configManager.config.customModelRates;
    const normalized = this.normalizeModelName(modelFamily);

    const rate: ModelRate | undefined =
      customRates[modelFamily]
      ?? customRates[normalized]
      ?? Object.entries(customRates).find(([key]) => normalized.includes(this.normalizeModelName(key)))?.[1];

    if (rate) {
      // Custom rates are in credits/1M tokens. Convert to USD: credits × 0.01
      return {
        input: rate.input * 0.01,
        output: rate.output * 0.01,
        cached: (rate.input * 0.01) / 2, // assume cached is half of input
      };
    }
    return undefined;
  }

  /**
   * Convert USD cost to AI Credits (1 credit = $0.01)
   */
  costToCredits(costUsd: number): number {
    return costUsd * 100;
  }

  /**
   * Convert USD to local currency using configured exchange rate
   */
  convertToLocalCurrency(costUsd: number): number {
    const rate = this.configManager?.config.exchangeRate
      ?? vscode.workspace.getConfiguration("copilotCostTracker").get<number>("exchangeRate", 1);
    return costUsd * rate;
  }

  getLocalCurrencySymbol(): string {
    return this.configManager?.config.currency
      ?? vscode.workspace.getConfiguration("copilotCostTracker").get<string>("currency", "USD");
  }

  getAllModels(): string[] {
    return Object.keys(this.pricing.models);
  }

  getUnknownModelDiagnostics(): UnknownModelDiagnostics {
    return {
      fallbackModelCount: this.unknownFallbackModels.size,
      fallbackModels: Array.from(this.unknownFallbackModels).sort((a, b) => a.localeCompare(b)),
      excludedTurnCount: this.unknownExcludedTurnCount,
      excludedModelCount: this.unknownExcludedModels.size,
      excludedModels: Array.from(this.unknownExcludedModels).sort((a, b) => a.localeCompare(b)),
    };
  }

  private shouldExcludeUnknownModels(): boolean {
    return this.configManager?.config.excludeUnknownModelsFromTotals
      ?? vscode.workspace.getConfiguration("copilotCostTracker").get<boolean>("excludeUnknownModelsFromTotals", false);
  }

  private normalizeModelName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replaceAll("_", "-");
  }

  /**
   * Calculate cost for a single model's token usage.
   */
  private calculateModelCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number,
    cacheWriteTokens: number
  ): number {
    const normalized = this.normalizeModelName(model);
    const pricing = this.getModelPricing(normalized);

    const inputCost = (inputTokens / 1_000_000) * (pricing?.input ?? 0);
    const outputCost = (outputTokens / 1_000_000) * (pricing?.output ?? 0);
    const cachedCost = (cachedTokens / 1_000_000) * (pricing?.cached ?? 0);
    const cacheWriteCost = (cacheWriteTokens / 1_000_000) * (pricing?.cacheWrite ?? 0);

    return inputCost + outputCost + cachedCost + cacheWriteCost;
  }

  /**
   * Calculate the cost of cache tokens (write + read) for a given model.
   * Used to compute cache savings metrics.
   * Returns cost in USD.
   */
  calculateCacheSavingsCost(
    modelFamily: string,
    cacheWriteTokens: number,
    cacheReadTokens: number
  ): number {
    const pricing = this.getModelPricing(modelFamily);
    if (!pricing) {
      // Use fallback pricing if model not found
      const writeTokensCost = (cacheWriteTokens / 1_000_000) * (DEFAULT_FALLBACK_RATE.cacheWrite ?? 0);
      const readTokensCost = (cacheReadTokens / 1_000_000) * DEFAULT_FALLBACK_RATE.cached;
      return writeTokensCost + readTokensCost;
    }

    // Cache write cost (if available) + cache read cost (cached rate)
    const writeTokensCost = pricing.cacheWrite
      ? (cacheWriteTokens / 1_000_000) * pricing.cacheWrite
      : 0;
    const readTokensCost = (cacheReadTokens / 1_000_000) * pricing.cached;
    return writeTokensCost + readTokensCost;
  }
}
