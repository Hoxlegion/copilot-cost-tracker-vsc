import * as vscode from "vscode";
import * as path from "node:path";
import { TracesDbReader, LogParser } from "./parser";
import { PricingEngine } from "./pricing";
import { CostDatabase, setWasmPath } from "./database";
import { TracesIngester } from "./watcher";
import { CostTreeProvider, DashboardPanel, StatusBarIndicator } from "./views";
import { ConfigManager } from "./config";
import { Logger } from "./logger";
import { PromptCostIntelligenceProvider } from "./promptCostIntelligence";

let database: CostDatabase | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Phase 1: Foundation — config + logger
  const configManager = new ConfigManager();
  const logger = new Logger(configManager.config.logLevel);

  configManager.onDidChange((cfg) => {
    logger.setLevel(cfg.logLevel);
    logger.debug("Configuration changed", cfg);
  });

  logger.info("Activating Copilot Cost Tracker");

  // Set WASM path for sql.js
  const wasmPath = path.join(context.extensionPath, "dist", "sql-wasm.wasm");
  setWasmPath(wasmPath);

  // Initialize core services
  const reader = new TracesDbReader(wasmPath);
  const logParser = new LogParser();
  const pricing = new PricingEngine();
  pricing.setDependencies(configManager, logger);
  await pricing.initialize();

  const storagePath = context.globalStorageUri.fsPath;
  database = new CostDatabase(storagePath);
  await database.initialize();

  // Initialize ingester with failover (traces DB primary, JSONL fallback)
  const ingester = new TracesIngester(reader, logParser, pricing, database, configManager, logger);
  ingester.setTelemetrySource(configManager.config.telemetrySource);

  // Initialize UI components
  const treeProvider = new CostTreeProvider(database, pricing);
  const statusBar = new StatusBarIndicator(database, pricing, configManager, logger);
  const promptIntelligence = new PromptCostIntelligenceProvider(configManager, logger);

  // Register TreeView
  const treeView = vscode.window.createTreeView("copilotCostTracker.overview", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  const promptCodeLensRegistration = vscode.languages.registerCodeLensProvider(
    [{ scheme: "file" }, { scheme: "untitled" }],
    promptIntelligence
  );
  const promptHoverRegistration = vscode.languages.registerHoverProvider(
    [{ scheme: "file" }, { scheme: "untitled" }],
    promptIntelligence
  );

  // Debounced UI refresh (D7): coalesce rapid data change events within 2s
  let refreshTimer: NodeJS.Timeout | undefined;
  let refreshDebounceMs = configManager.config.refreshDebounceMs;
  const debouncedRefresh = () => {
    if (refreshTimer) { clearTimeout(refreshTimer); }
    refreshTimer = setTimeout(() => {
      treeProvider.refresh();
      statusBar.update();
      if (DashboardPanel.currentPanel) {
        void DashboardPanel.currentPanel.update();
      }
    }, refreshDebounceMs);
  };

  // React to data changes
  ingester.onDidDataChange(() => {
    debouncedRefresh();
  });

  // React to config changes
  configManager.onDidChange((cfg) => {
    refreshDebounceMs = cfg.refreshDebounceMs;
    statusBar.updateVisibility();
    treeProvider.refresh();
    ingester.setTelemetrySource(cfg.telemetrySource);
    ingester.updatePollingBounds(cfg.pollIntervalMin, cfg.pollIntervalMax);
  });

  // Register commands
  const refreshCmd = vscode.commands.registerCommand(
    "copilotCostTracker.refresh",
    async () => {
      await pricing.refreshPricing();
      const count = await ingester.fullIngest();
      treeProvider.refresh();
      statusBar.update();
      vscode.window.showInformationMessage(
        `Copilot Cost Tracker: Refreshed. ${count} new turns processed.`
      );
    }
  );

  const dashboardCmd = vscode.commands.registerCommand(
    "copilotCostTracker.openDashboard",
    () => {
      DashboardPanel.createOrShow(context.extensionUri, database!, pricing, reader);
    }
  );

  const scanAllCmd = vscode.commands.registerCommand(
    "copilotCostTracker.scanAll",
    async () => {
      const count = await ingester.fullIngest();
      treeProvider.refresh();
      statusBar.update();
      vscode.window.showInformationMessage(
        `Copilot Cost Tracker: Full scan complete. ${count} turns processed.`
      );
    }
  );

  const scanFullHistoryCmd = vscode.commands.registerCommand(
    "copilotCostTracker.scanFullHistory",
    async () => {
      vscode.window.showInformationMessage("Copilot Cost Tracker: Starting full history backfill...");
      const count = await ingester.ingest(0);
      treeProvider.refresh();
      statusBar.update();
      vscode.window.showInformationMessage(
        `Copilot Cost Tracker: Full history backfill complete. ${count} turns processed.`
      );
    }
  );

  // Initial bounded ingest (last N days per config) + start polling
  const initialScanSinceMs = Date.now() - configManager.config.initialScanDays * 24 * 60 * 60 * 1000;
  await ingester.ingest(initialScanSinceMs);
  treeProvider.refresh();
  statusBar.update();
  ingester.startPolling(configManager.config.pollIntervalMin, configManager.config.pollIntervalMax);

  // Prune old data on startup to enforce retention policy (D8)
  const pruned = database.pruneOldTurns(configManager.config.retentionDays);
  if (pruned > 0) {
    logger.info(`Pruned ${pruned} old turns based on retentionDays=${configManager.config.retentionDays}`);
  }

  // Periodic save timer (D4): flush cost DB to disk every 60s
  const saveInterval = setInterval(() => {
    if (database) {
      database.save();
      logger.trace("Periodic save completed");
    }
  }, 60000);

  // Periodic pruning timer (D8): prune old data every 24 hours to prevent unbounded growth
  const pruneInterval = setInterval(() => {
    if (database) {
      const count = database.pruneOldTurns(configManager.config.retentionDays);
      if (count > 0) {
        logger.info(`Periodic pruning removed ${count} old turns`);
        database.save();
      }
    }
  }, 24 * 60 * 60 * 1000); // 24 hours

  // Periodic pricing refresh: check remote pricing URL once per day.
  // PricingEngine keeps its own 24h fetch gate, so this is safe to run on a fixed interval.
  const pricingRefreshInterval = setInterval(() => {
    void pricing.refreshPricing()
      .then(() => logger.trace("Periodic pricing refresh check completed"))
      .catch((err) => logger.warn("Periodic pricing refresh check failed", err));
  }, 24 * 60 * 60 * 1000); // 24 hours

  logger.info("Activation complete");

  // Register disposables
  context.subscriptions.push(
    configManager,
    logger,
    promptIntelligence,
    treeView,
    promptCodeLensRegistration,
    promptHoverRegistration,
    statusBar,
    ingester,
    refreshCmd,
    dashboardCmd,
    scanAllCmd,
    scanFullHistoryCmd,
    { dispose: () => clearInterval(saveInterval) },
    { dispose: () => clearInterval(pruneInterval) },
    { dispose: () => clearInterval(pricingRefreshInterval) }
  );
}

export function deactivate(): void {
  if (database) {
    database.close();
  }
}
