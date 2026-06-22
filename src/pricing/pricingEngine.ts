import * as vscode from "vscode";
import { DEFAULT_PRICING, ModelPricing, PricingData } from "./defaultPricing";
import { ConfigManager, ModelRate } from "../config";
import { Logger } from "../logger";

// Built-in fallback rate for truly unknown models (GPT-5.4 tier, 250/25/1500 credits/1M)
const DEFAULT_FALLBACK_RATE: ModelPricing = {
  input: 2.5,  // 250 credits/1M → $2.50 USD
  output: 15,  // 1500 credits/1M → $15.00 USD
  cached: 0.25, // 25 credits/1M → $0.25 USD
  cacheWrite: 3.75, // 375 credits/1M → $3.75 USD (1.5× input)
};

// Models that are included in all Copilot plans and never consume AI Credits:
// inline code completions and Next Edit Suggestions (NES). These carry no
// `nano_aiu` billing attribute, so they must be priced at $0 rather than estimated.
// Matched by normalized-name prefix because the codename suffix changes over time
// (e.g. "copilot-nes-oct", "copilot-suggestions-himalia-001").
const FREE_MODEL_PREFIXES = ["copilot-nes", "copilot-suggestions"];

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

  constructor(configManager?: ConfigManager, logger?: Logger) {
    if (configManager) this.configManager = configManager;
    if (logger) this.logger = logger;
  }

  /**
   * Set dependencies (kept for backward compatibility; prefer constructor injection).
   */
  setDependencies(configManager: ConfigManager, logger: Logger): void {
    this.configManager = configManager;
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    await this.refreshPricing();
  }

  async refreshPricing(): Promise<void> {
    const url = this.configManager?.config.pricingUrl
      ?? vscode.workspace.getConfiguration("copilotCostTracker").get<string>("pricingUrl", "");

    if (url && Date.now() - this.lastFetch > this.FETCH_INTERVAL_MS) {
      const fetched = await this.fetchRemotePricing(url);
      if (fetched) return;
    }

    // Fall back to built-in table (updated manually from GitHub Docs on each release).
    if (!this.lastFetch) {
      this.pricing = DEFAULT_PRICING;
      this.logger?.debug("Using built-in pricing table");
    }
  }

  private async fetchRemotePricing(url: string): Promise<boolean> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      this.logger?.warn(`Invalid pricing URL: "${url}" — skipping remote fetch`);
      return false;
    }

    if (parsedUrl.protocol !== "https:") {
      this.logger?.warn(`Pricing URL must use HTTPS (got "${parsedUrl.protocol}") — skipping remote fetch`);
      return false;
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return false;

      const remote = (await response.json()) as PricingData;
      const validationError = this.validatePricingData(remote);
      if (validationError) {
        this.logger?.warn(`Remote pricing JSON failed validation: ${validationError}; using built-in pricing`);
        return false;
      }

      this.pricing = remote;
      this.lastFetch = Date.now();
      this.logger?.debug("Pricing updated from remote URL");
      return true;
    } catch (err) {
      this.logger?.warn("Failed to fetch remote pricing; using built-in pricing", err);
      return false;
    }
  }

  getModelPricing(modelFamily: string): ModelPricing | undefined {
    const normalized = this.normalizeModelName(modelFamily);
    return this.pricing.models[normalized];
  }

  /**
   * Whether a model is included for free in all Copilot plans (inline completions / NES)
   * and therefore never consumes AI Credits.
   */
  isFreeModel(modelFamily: string): boolean {
    const normalized = this.normalizeModelName(modelFamily);
    return FREE_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
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
    // Free models (inline completions, Next Edit Suggestions) never consume AI Credits.
    if (this.isFreeModel(modelFamily)) {
      return 0;
    }

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
   * Estimate the input-token cost in USD for a UI prediction (e.g. context-cost
   * preview). Uses the given model's input rate when it is known or has a custom
   * rate; otherwise falls back to the built-in default tier rate. Unlike
   * {@link calculateCost}, this never logs warnings or records unknown-model
   * diagnostics, since it is a best-effort estimate rather than a billed turn.
   */
  estimateInputCost(modelFamily: string | null | undefined, inputTokens: number): number {
    let pricing: ModelPricing | undefined;
    if (modelFamily) {
      if (this.isFreeModel(modelFamily)) {
        return 0;
      }
      pricing = this.getModelPricing(modelFamily) ?? this.getCustomRate(modelFamily);
    }
    const rate = pricing ?? DEFAULT_FALLBACK_RATE;
    return (inputTokens / 1_000_000) * rate.input;
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
        cached: (rate.input * 0.01) / 10, // cached input is ~1/10 of the input rate
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

  /** Validate full pricing data structure. Returns null on success, error string on failure. */
  private validatePricingData(data: unknown): string | null {
    const d = data as Record<string, unknown>;
    if (!d.version || typeof d.version !== "string") return "missing or invalid 'version'";
    if (!d.models || typeof d.models !== "object") return "missing or invalid 'models'";
    const MAX_RATE = 1000;
    for (const [key, val] of Object.entries(d.models as Record<string, unknown>)) {
      if (!val || typeof val !== "object") return `model "${key}": value is not an object`;
      const m = val as Record<string, unknown>;
      if (typeof m.input !== "number" || typeof m.output !== "number" || typeof m.cached !== "number") {
        return `model "${key}": missing required numeric fields (input, output, cached)`;
      }
      if (m.input < 0 || m.output < 0 || m.cached < 0) return `model "${key}": negative rate`;
      if (m.input > MAX_RATE || m.output > MAX_RATE || m.cached > MAX_RATE) return `model "${key}": rate exceeds $${MAX_RATE}/1M ceiling`;
    }
    return null;
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

  /**
   * Calculate the real savings from cache reads: the difference between paying the full
   * input rate and the (cheaper) cached rate for cache-read tokens. Returns USD.
   * Free models save nothing (they are not billed).
   */
  calculateCacheSavings(
    modelFamily: string,
    _cacheWriteTokens: number,
    cacheReadTokens: number
  ): number {
    if (this.isFreeModel(modelFamily)) return 0;
    const pricing = this.getModelPricing(modelFamily)
      ?? this.getCustomRate(modelFamily)
      ?? DEFAULT_FALLBACK_RATE;
    const perTokenSavings = Math.max(0, pricing.input - pricing.cached);
    return (cacheReadTokens / 1_000_000) * perTokenSavings;
  }
}

