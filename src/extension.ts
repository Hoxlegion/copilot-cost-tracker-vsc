import * as vscode from "vscode";
import * as path from "node:path";
import { TracesDbReader, LogParser } from "./parser";
import { PricingEngine } from "./pricing";
import { CostDatabase, setWasmPath } from "./database";
import { TracesIngester } from "./watcher";
import { DashboardPanel, StatusBarIndicator, ContextTracker, SidebarPanel, getCurrentWorkspaceRepo } from "./views";
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
    // Don't alarm the user — the JSONL fallback will handle it silently.
    // Only show a message if the user opens the cost tracker and has no data.
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
  const pricing = new PricingEngine(configManager, logger);
  await pricing.initialize();

  const storagePath = context.globalStorageUri.fsPath;
  database = new CostDatabase(storagePath);
  await database.initialize();
  // Persist schema migrations (e.g. new columns) to disk immediately
  // so they survive window reloads before the periodic 60s save.
  await database.save();

  if (database.didRecoverFromCorruption) {
    logger.warn("Database was corrupted and has been reset");
    void vscode.window.showWarningMessage(
      "Copilot Cost Tracker: The cost database was corrupted and has been reset. Historical data was lost."
    );
  }

  // Derive workspace storage hash from storageUri (e.g. .../workspaceStorage/{hash}/extension-name/)
  // This gives resolveWorkspaceName a proper hash it can look up in workspace.json
  const workspaceStorageHash = context.storageUri
    ? path.basename(path.dirname(context.storageUri.fsPath))
    : "unknown";

  // Ingestion pipeline
  const ingester = new TracesIngester(reader, logParser, pricing, database, configManager, logger, workspaceStorageHash);
  ingester.setTelemetrySource(configManager.config.telemetrySource);

  // UI components
  const contextTracker = new ContextTracker(database, logger, getCurrentWorkspaceRepo());
  contextTracker.setNotificationsEnabled(configManager.config.contextWeightNotifications);
  const statusBar = new StatusBarIndicator(database, pricing, configManager, logger, contextTracker, getCurrentWorkspaceRepo());
  const promptIntelligence = new PromptCostIntelligenceProvider(configManager, logger);
  const sidebarProvider = new SidebarPanel(database, pricing);

  // Register sidebar webview, CodeLens, and Hover
  const sidebarView = vscode.window.registerWebviewViewProvider(
    SidebarPanel.viewType,
    sidebarProvider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );

  const promptCodeLens = vscode.languages.registerCodeLensProvider(
    [{ scheme: "file" }, { scheme: "untitled" }], promptIntelligence
  );
  const promptHover = vscode.languages.registerHoverProvider(
    [{ scheme: "file" }, { scheme: "untitled" }], promptIntelligence
  );

  // Event wiring
  const refreshAll = () => {
    sidebarProvider.refresh();
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
    sidebarProvider.refresh();
    ingester.setTelemetrySource(cfg.telemetrySource);
    ingester.updateWatchOptions(cfg.refreshDebounceMs, cfg.pollIntervalMax);
  });

  // Commands
  registerCommands(context, {
    database, pricing, ingester, reader, statusBar,
    extensionUri: context.extensionUri,
  });

  // Initial ingest + start file watcher
  const initialScanSinceMs = Date.now() - configManager.config.initialScanDays * 24 * 60 * 60 * 1000;
  const initialCount = await ingester.ingest(initialScanSinceMs);
  sidebarProvider.refresh();
  contextTracker.update();
  statusBar.update();
  const tracesDbPath = reader.exists() ? reader.path : null;
  ingester.startWatching(tracesDbPath, configManager.config.refreshDebounceMs, configManager.config.pollIntervalMax);

  // Show setup guidance only when no data at all after initial ingest
  if (initialCount === 0 && !reader.exists()) {
    const config = vscode.workspace.getConfiguration();
    const isEnabled = config.get<boolean>(COPILOT_DB_SPAN_EXPORTER_KEY, false);
    if (!isEnabled) {
      const action = await vscode.window.showInformationMessage(
        "Copilot Cost Tracker: No usage data found. Enable Copilot telemetry to start tracking costs.",
        "Enable Now"
      );
      if (action === "Enable Now") {
        try {
          await config.update(COPILOT_DB_SPAN_EXPORTER_KEY, true, vscode.ConfigurationTarget.Global);
          logger.info("User enabled Copilot DB span exporter via prompt");
          void vscode.window.showInformationMessage(
            "Copilot telemetry enabled. Usage data will appear after your next Copilot interaction."
          );
        } catch {
          void vscode.window.showWarningMessage(
            `Please set "${COPILOT_DB_SPAN_EXPORTER_KEY}" to true in your settings manually.`
          );
        }
      }
    }
  }

  // Startup prune
  const pruned = database.pruneOldTurns(configManager.config.retentionDays);
  if (pruned > 0) {
    logger.info(`Pruned ${pruned} old turns based on retentionDays=${configManager.config.retentionDays}`);
  }

  // Periodic timers — lightweight UI refresh only (no disk I/O).
  // Ingestion is handled by the file watcher + fallback poll in TracesIngester.
  setupTimers(context, database, pricing, configManager, logger, {
    contextTracker,
    statusBar,
  });

  logger.info("Activation complete");

  // Disposables
  context.subscriptions.push(
    configManager, logger, promptIntelligence, sidebarView,
    promptCodeLens, promptHover, statusBar, contextTracker, ingester,
    reader,
  );
}

export function deactivate(): void {
  if (database) {
    database.close();
  }
}
