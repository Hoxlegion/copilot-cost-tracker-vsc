import * as vscode from "vscode";
import { CostDatabase } from "./database";
import { PricingEngine } from "./pricing";
import { ConfigManager } from "./config";
import { Logger } from "./logger";

export function setupTimers(
  context: vscode.ExtensionContext,
  database: CostDatabase,
  pricing: PricingEngine,
  configManager: ConfigManager,
  logger: Logger,
): void {
  const saveInterval = setInterval(() => {
    database.save();
    logger.trace("Periodic save completed");
  }, 60000);

  const pruneInterval = setInterval(() => {
    const count = database.pruneOldTurns(configManager.config.retentionDays);
    if (count > 0) {
      logger.info(`Periodic pruning removed ${count} old turns`);
      database.save();
    }
  }, 24 * 60 * 60 * 1000);

  const pricingRefreshInterval = setInterval(() => {
    void pricing.refreshPricing()
      .then(() => logger.trace("Periodic pricing refresh check completed"))
      .catch((err) => logger.warn("Periodic pricing refresh check failed", err));
  }, 24 * 60 * 60 * 1000);

  context.subscriptions.push(
    { dispose: () => clearInterval(saveInterval) },
    { dispose: () => clearInterval(pruneInterval) },
    { dispose: () => clearInterval(pricingRefreshInterval) },
  );
}
