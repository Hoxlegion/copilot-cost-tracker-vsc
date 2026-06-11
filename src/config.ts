import * as vscode from "vscode";

/**
 * Log level for the extension's OutputChannel logger.
 */
export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

/**
 * Telemetry source preference for data ingestion.
 */
export type TelemetrySource = "auto" | "database" | "jsonl";

/**
 * Custom model rate definition (credits per 1M tokens).
 */
export interface ModelRate {
  input: number;
  output: number;
}

/**
 * The validated, typed configuration object for the extension.
 * All values are clamped/sanitized to safe ranges.
 */
export interface ExtensionConfig {
  // Polling
  pollIntervalMin: number;
  pollIntervalMax: number;
  refreshDebounceMs: number;

  // Billing
  billingCycleStartDay: number;
  budgetCredits: number;
  budgetWarningThresholds: number[];

  // Data source
  telemetrySource: TelemetrySource;
  initialScanDays: number;
  retentionDays: number;

  // Pricing
  customModelRates: Record<string, ModelRate>;
  pricingUrl: string;
  excludeUnknownModelsFromTotals: boolean;

  // Filtering
  excludedModels: string[];
  enabledFileExtensions: string[];

  // Plan
  plan: string;

  // Display
  currency: string;
  exchangeRate: number;
  showStatusBar: boolean;
  contextWeightNotifications: boolean;

  // Logging
  logLevel: LogLevel;
}

const SECTION = "copilotCostTracker";

const LOG_LEVELS = new Set<LogLevel>(["error", "warn", "info", "debug", "trace"]);
const TELEMETRY_SOURCES = new Set<TelemetrySource>(["auto", "database", "jsonl"]);
const MODEL_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function sanitizeModelName(value: string): string | null {
  const trimmed = value.trim();
  if (!MODEL_NAME_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Clamp a number between min and max.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseCustomModelRates(rawCustomRates: unknown): Record<string, ModelRate> {
  const customModelRates: Record<string, ModelRate> = {};
  if (!rawCustomRates || typeof rawCustomRates !== "object") {
    return customModelRates;
  }

  const entries = Object.entries(rawCustomRates as Record<string, unknown>).slice(0, 100);
  for (const [model, rate] of entries) {
    const safeModel = sanitizeModelName(model);
    if (!safeModel) {
      console.warn(`[Config] Skipping custom model rate: "${model}" failed name validation`);
      continue;
    }

    const input = Number((rate as ModelRate | undefined)?.input);
    const output = Number((rate as ModelRate | undefined)?.output);
    if (
      Number.isFinite(input) &&
      Number.isFinite(output) &&
      input >= 0 &&
      output >= 0 &&
      input <= 1_000_000_000 &&
      output <= 1_000_000_000
    ) {
      customModelRates[safeModel] = { input, output };
    } else {
      console.warn(`[Config] Skipping custom model rate: "${model}" has invalid input/output values`);
    }
  }

  return customModelRates;
}

/**
 * Read and validate the full configuration from VS Code settings.
 */
function readConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration(SECTION);

  const pollIntervalMin = clamp(cfg.get<number>("pollIntervalMin") ?? 5000, 1000, 300000);
  const rawPollMax = clamp(cfg.get<number>("pollIntervalMax") ?? 30000, pollIntervalMin, 600000);
  const pollIntervalMax = Math.max(rawPollMax, pollIntervalMin);
  if (rawPollMax < pollIntervalMin) {
    console.warn(`[Config] pollIntervalMax (${cfg.get<number>("pollIntervalMax")}) is less than pollIntervalMin (${pollIntervalMin}), clamping to ${pollIntervalMax}`);
  }
  const refreshDebounceMs = clamp(Math.round(cfg.get<number>("refreshDebounceMs") ?? 300), 100, 5000);

  const billingCycleStartDay = clamp(Math.round(cfg.get<number>("billingCycleStartDay") ?? 1), 1, 31);
  const budgetCredits = Math.max(cfg.get<number>("budgetCredits") ?? 180, 0);

  const rawThresholds = cfg.get<number[]>("budgetWarningThresholds") ?? [75, 90, 100];
  const budgetWarningThresholds = Array.isArray(rawThresholds)
    ? rawThresholds.filter((t) => typeof t === "number" && t >= 0 && t <= 100).sort((a, b) => a - b)
    : [75, 90, 100];

  const rawTelemetry = cfg.get<string>("telemetrySource") ?? "auto";
  const telemetrySource: TelemetrySource = TELEMETRY_SOURCES.has(rawTelemetry as TelemetrySource)
    ? (rawTelemetry as TelemetrySource)
    : "auto";

  const initialScanDays = clamp(Math.round(cfg.get<number>("initialScanDays") ?? 30), 1, 365);
  const retentionDays = clamp(Math.round(cfg.get<number>("retentionDays") ?? 90), 1, 3650);

  const rawCustomRates = cfg.get<Record<string, ModelRate>>("customModelRates") ?? {};
  const customModelRates = parseCustomModelRates(rawCustomRates);

  const pricingUrl = cfg.get<string>("pricingUrl") ?? "";
  const excludeUnknownModelsFromTotals = cfg.get<boolean>("excludeUnknownModelsFromTotals") ?? false;

  const rawExcluded = cfg.get<string[]>("excludedModels") ?? ["gpt-4o-mini"];
  const excludedModels = Array.isArray(rawExcluded)
    ? Array.from(
      new Set(
        rawExcluded
          .slice(0, 200)
          .filter((m) => typeof m === "string")
          .map((m) => sanitizeModelName(m))
          .filter((m): m is string => m !== null)
      )
    )
    : ["gpt-4o-mini"];

  const rawEnabledExtensions = cfg.get<string[]>("enabledFileExtensions") ?? [".prompt", ".md"];
  const enabledFileExtensions = Array.isArray(rawEnabledExtensions)
    ? Array.from(
      new Set(
        rawEnabledExtensions
          .slice(0, 100)
          .filter((e) => typeof e === "string" && e.trim().length > 0)
          .map((e) => e.startsWith(".") ? e.trim() : `.${e.trim()}`)
          .map((e) => e.toLowerCase())
          .filter((e) => /^\.[a-z0-9_-]{1,20}$/.test(e))
      )
    )
    : [".prompt", ".md"];

  const plan = cfg.get<string>("plan") ?? "pro";

  const currency = cfg.get<string>("currency") ?? "USD";
  const exchangeRate = Math.max(cfg.get<number>("exchangeRate") ?? 1, 0.0001);
  const showStatusBar = cfg.get<boolean>("showStatusBar") ?? true;
  const contextWeightNotifications = cfg.get<boolean>("contextWeightNotifications") ?? true;

  const rawLogLevel = cfg.get<string>("logLevel") ?? "error";
  const logLevel: LogLevel = LOG_LEVELS.has(rawLogLevel as LogLevel)
    ? (rawLogLevel as LogLevel)
    : "error";

  return {
    pollIntervalMin,
    pollIntervalMax,
    refreshDebounceMs,
    billingCycleStartDay,
    budgetCredits,
    budgetWarningThresholds,
    telemetrySource,
    initialScanDays,
    retentionDays,
    customModelRates,
    pricingUrl,
    excludeUnknownModelsFromTotals,
    excludedModels,
    enabledFileExtensions,
    plan,
    currency,
    exchangeRate,
    showStatusBar,
    contextWeightNotifications,
    logLevel,
  };
}

/**
 * Centralized configuration manager with reactive caching.
 * Re-reads only on `onDidChangeConfiguration` events.
 */
export class ConfigManager implements vscode.Disposable {
  private _config: ExtensionConfig;
  private readonly _onDidChange = new vscode.EventEmitter<ExtensionConfig>();
  private readonly _disposable: vscode.Disposable;

  /** Fires when any copilotCostTracker.* setting changes. Provides the new config. */
  readonly onDidChange: vscode.Event<ExtensionConfig> = this._onDidChange.event;

  constructor() {
    this._config = readConfig();
    this._disposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(SECTION)) {
        this._config = readConfig();
        this._onDidChange.fire(this._config);
      }
    });
  }

  /** Get the current cached configuration. */
  get config(): ExtensionConfig {
    return this._config;
  }

  dispose(): void {
    this._onDidChange.dispose();
    this._disposable.dispose();
  }
}
