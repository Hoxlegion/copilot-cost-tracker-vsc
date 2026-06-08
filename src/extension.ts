import * as vscode from "vscode";
import * as path from "node:path";
import { TracesDbReader, LogParser } from "./parser";
import { PricingEngine } from "./pricing";
import { CostDatabase, setWasmPath } from "./database";
import { TracesIngester } from "./watcher";
import { CostTreeProvider, DashboardPanel, StatusBarIndicator, ContextTracker } from "./views";
import { ConfigManager } from "./config";
import { Logger } from "./logger";
import { PromptCostIntelligenceProvider } from "./promptCostIntelligence";
import { registerCommands } from "./commands";
import { setupTimers } from "./timers";

let database: CostDatabase | undefined;
const COPILOT_DB_SPAN_EXPORTER_KEY = "github.copilot.chat.otel.dbSpanExporter.enabled";

async function ensureCopilotDbSpanExporterEnabled(logger: Logger): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const isEnabled = config.get<boolean>(COPILOT_DB_SPAN_EXPORTER_KEY, false);

  if (isEnabled) {
    return;
  }

  try {
    await config.update(COPILOT_DB_SPAN_EXPORTER_KEY, true, vscode.ConfigurationTarget.Global);
    logger.info(`Auto-enabled setting: ${COPILOT_DB_SPAN_EXPORTER_KEY}`);
  } catch (error) {
    logger.warn(`Failed to auto-enable setting: ${COPILOT_DB_SPAN_EXPORTER_KEY}`, error);
    void vscode.window.showWarningMessage(
      "Copilot Cost Tracker could not auto-enable Copilot DB telemetry export. "
      + `Please set ${COPILOT_DB_SPAN_EXPORTER_KEY} to true in your settings.`
    );
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Foundation
  const configManager = new ConfigManager();
  const logger = new Logger(configManager.config.logLevel);

  configManager.onDidChange((cfg) => {
    logger.setLevel(cfg.logLevel);
    logger.debug("Configuration changed", cfg);
  });

  logger.info("Activating Copilot Cost Tracker");
  await ensureCopilotDbSpanExporterEnabled(logger);

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

  // UI components
  const contextTracker = new ContextTracker(database, logger);
  contextTracker.setNotificationsEnabled(configManager.config.contextWeightNotifications);
  const treeProvider = new CostTreeProvider(database, pricing);
  const statusBar = new StatusBarIndicator(database, pricing, configManager, logger, contextTracker);
  const promptIntelligence = new PromptCostIntelligenceProvider(configManager, logger);

  // Register TreeView, CodeLens, and Hover
  const treeView = vscode.window.createTreeView("copilotCostTracker.overview", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  const promptCodeLens = vscode.languages.registerCodeLensProvider(
    [{ scheme: "file" }, { scheme: "untitled" }], promptIntelligence
  );
  const promptHover = vscode.languages.registerHoverProvider(
    [{ scheme: "file" }, { scheme: "untitled" }], promptIntelligence
  );

  // Event wiring
  const refreshAll = () => {
    treeProvider.refresh();
    contextTracker.update();
    statusBar.update();
    if (DashboardPanel.currentPanel) {
      void DashboardPanel.currentPanel.update();
    }
  };

  ingester.onDidDataChange(() => refreshAll());

  configManager.onDidChange((cfg) => {
    contextTracker.setNotificationsEnabled(cfg.contextWeightNotifications);
    statusBar.updateVisibility();
    treeProvider.refresh();
    ingester.setTelemetrySource(cfg.telemetrySource);
    ingester.updateWatchOptions(cfg.refreshDebounceMs, cfg.pollIntervalMax);
  });

  // Commands
  registerCommands(context, {
    database, pricing, ingester, reader, treeProvider, statusBar,
    extensionUri: context.extensionUri,
  });

  // Initial ingest + start file watcher
  const initialScanSinceMs = Date.now() - configManager.config.initialScanDays * 24 * 60 * 60 * 1000;
  await ingester.ingest(initialScanSinceMs);
  treeProvider.refresh();
  contextTracker.update();
  statusBar.update();
  const tracesDbPath = reader.exists() ? reader.path : null;
  ingester.startWatching(tracesDbPath, configManager.config.refreshDebounceMs, configManager.config.pollIntervalMax);

  // Startup prune
  const pruned = database.pruneOldTurns(configManager.config.retentionDays);
  if (pruned > 0) {
    logger.info(`Pruned ${pruned} old turns based on retentionDays=${configManager.config.retentionDays}`);
  }

  // Periodic timers
  setupTimers(context, database, pricing, configManager, logger);

  logger.info("Activation complete");

  // Disposables
  context.subscriptions.push(
    configManager, logger, promptIntelligence, treeView,
    promptCodeLens, promptHover, statusBar, contextTracker, ingester,
  );
}

export function deactivate(): void {
  if (database) {
    database.close();
  }
}
