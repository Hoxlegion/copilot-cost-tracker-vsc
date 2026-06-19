import * as vscode from "vscode";
import { CostMaintenance } from "./database";
import { PricingEngine } from "./pricing";
import { ConfigManager } from "./config";
import { Logger } from "./logger";
import { ContextTracker, StatusBarIndicator } from "./views";

export interface TimerConfig {
  contextRefreshIntervalMs?: number;
}

export interface TimerOptions {
  contextTracker?: ContextTracker;
  statusBar?: StatusBarIndicator;
  timerConfig?: TimerConfig;
}

export function setupTimers(
  context: vscode.ExtensionContext,
  database: CostMaintenance,
  pricing: PricingEngine,
  configManager: ConfigManager,
  logger: Logger,
  options?: TimerOptions,
): void {
  const SAVE_INTERVAL_MS = 60_000;
  const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

  const saveInterval = setInterval(() => {
    database.save()
      .then(() => logger.trace("Periodic save completed"))
      .catch((err) => logger.warn("Periodic save failed", err));
  }, SAVE_INTERVAL_MS);

  const pruneInterval = setInterval(() => {
    try {
      const count = database.pruneOldTurns(configManager.config.retentionDays);
      if (count > 0) {
        logger.info(`Periodic pruning removed ${count} old turns`);
        database.save().catch((err) => logger.warn("Save after pruning failed", err));
      }
    } catch (err) {
      logger.warn("Periodic pruning failed", err);
    }
  }, DAILY_INTERVAL_MS);

  const pricingRefreshInterval = setInterval(() => {
    void pricing.refreshPricing()
      .then(() => logger.trace("Periodic pricing refresh check completed"))
      .catch((err) => logger.warn("Periodic pricing refresh check failed", err));
  }, DAILY_INTERVAL_MS);

  // Lightweight periodic UI refresh from the in-memory cost database.
  // This does NOT re-read the traces DB from disk — ingestion is handled
  // separately by the file watcher / fallback poll in TracesIngester.
  // The purpose is to detect when the most-recent session in our local DB
  // has changed (e.g. new turns ingested by the watcher) and refresh the
  // footer accordingly, plus expire stale context when there's no activity.
  const contextRefreshIntervalMs = options?.timerConfig?.contextRefreshIntervalMs ?? 5000;
  const contextRefreshInterval = setInterval(() => {
    if (!options?.contextTracker || !options?.statusBar) { return; }
    options.contextTracker.update();
    options.statusBar.update();
  }, contextRefreshIntervalMs);

  context.subscriptions.push(
    { dispose: () => clearInterval(saveInterval) },
    { dispose: () => clearInterval(pruneInterval) },
    { dispose: () => clearInterval(pricingRefreshInterval) },
    { dispose: () => clearInterval(contextRefreshInterval) },
  );
}
