import * as vscode from "vscode";
import * as path from "node:path";
import { TracesDbReader, LogParser } from "./parser";
import { PricingEngine } from "./pricing";
import { CostDatabase, setWasmPath } from "./database";
import { TracesIngester } from "./watcher";
import { StatusBarIndicator } from "./views";
import { ConfigManager } from "./config";
import { Logger } from "./logger";

let database: CostDatabase | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Foundation
  const configManager = new ConfigManager();
  const logger = new Logger(configManager.config.logLevel);

  configManager.onDidChange((cfg) => {
    logger.setLevel(cfg.logLevel);
    logger.debug("Configuration changed", cfg);
  });

  logger.info("Activating Copilot Cost Tracker");

  // WASM path for sql.js
  const wasmPath = path.join(context.extensionPath, "dist", "sql-wasm.wasm");
  setWasmPath(wasmPath);

  // Core services
  const reader = new TracesDbReader(wasmPath);
  const logParser = new LogParser();
  const pricing = new PricingEngine();
  pricing.setDependencies(configManager, logger);
  await pricing.initialize();

  const storagePath = context.globalStorageUri.fsPath;
  database = new CostDatabase(storagePath);
  await database.initialize();

  // Ingestion pipeline
  const ingester = new TracesIngester(reader, logParser, pricing, database, configManager, logger);
  ingester.setTelemetrySource(configManager.config.telemetrySource);

  const statusBar = new StatusBarIndicator(database, pricing, configManager, logger);

  // Debounced UI refresh
  let refreshTimer: NodeJS.Timeout | undefined;
  let refreshDebounceMs = configManager.config.refreshDebounceMs;
  const debouncedRefresh = () => {
    if (refreshTimer) { clearTimeout(refreshTimer); }
    refreshTimer = setTimeout(() => {
      statusBar.update();
    }, refreshDebounceMs);
  };

  // Event wiring
  ingester.onDidDataChange(() => debouncedRefresh());

  configManager.onDidChange((cfg) => {
    refreshDebounceMs = cfg.refreshDebounceMs;
    statusBar.updateVisibility();
    ingester.setTelemetrySource(cfg.telemetrySource);
    ingester.updatePollingBounds(cfg.pollIntervalMin, cfg.pollIntervalMax);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("copilotCostTracker.refresh", async () => {
      await pricing.refreshPricing();
      const count = await ingester.fullIngest();
      statusBar.update();
      vscode.window.showInformationMessage(`Copilot Cost Footer: Refreshed. ${count} new turns processed.`);
    })
  );

  // Initial ingest + start polling
  const initialScanSinceMs = Date.now() - configManager.config.initialScanDays * 24 * 60 * 60 * 1000;
  await ingester.ingest(initialScanSinceMs);
  statusBar.update();
  ingester.startPolling(configManager.config.pollIntervalMin, configManager.config.pollIntervalMax);

  // Startup prune
  const pruned = database.pruneOldTurns(configManager.config.retentionDays);
  if (pruned > 0) {
    logger.info(`Pruned ${pruned} old turns based on retentionDays=${configManager.config.retentionDays}`);
  }

  logger.info("Activation complete");

  // Disposables
  context.subscriptions.push(
    configManager, logger, statusBar, ingester,
  );
}

export function deactivate(): void {
  if (database) {
    database.close();
  }
}
