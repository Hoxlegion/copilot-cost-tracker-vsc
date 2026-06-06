import * as vscode from "vscode";
import { CostDatabase } from "./database";
import { PricingEngine } from "./pricing";
import { TracesDbReader } from "./parser";
import { TracesIngester } from "./watcher";
import { CostTreeProvider, DashboardPanel, StatusBarIndicator } from "./views";

interface CommandDeps {
  database: CostDatabase;
  pricing: PricingEngine;
  ingester: TracesIngester;
  reader: TracesDbReader;
  treeProvider: CostTreeProvider;
  statusBar: StatusBarIndicator;
  extensionUri: vscode.Uri;
}

export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  const { database, pricing, ingester, reader, treeProvider, statusBar, extensionUri } = deps;

  const refreshAndUpdate = () => {
    treeProvider.refresh();
    statusBar.update();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("copilotCostTracker.refresh", async () => {
      await pricing.refreshPricing();
      const count = await ingester.fullIngest();
      refreshAndUpdate();
      vscode.window.showInformationMessage(`Copilot Cost Tracker: Refreshed. ${count} new turns processed.`);
    }),

    vscode.commands.registerCommand("copilotCostTracker.openDashboard", () => {
      DashboardPanel.createOrShow(extensionUri, database, pricing, reader);
    }),

    vscode.commands.registerCommand("copilotCostTracker.scanAll", async () => {
      const count = await ingester.fullIngest();
      refreshAndUpdate();
      vscode.window.showInformationMessage(`Copilot Cost Tracker: Full scan complete. ${count} turns processed.`);
    }),

    vscode.commands.registerCommand("copilotCostTracker.scanFullHistory", async () => {
      vscode.window.showInformationMessage("Copilot Cost Tracker: Starting full history backfill...");
      const count = await ingester.ingest(0);
      refreshAndUpdate();
      vscode.window.showInformationMessage(`Copilot Cost Tracker: Full history backfill complete. ${count} turns processed.`);
    }),
  );
}
