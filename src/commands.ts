import * as vscode from "vscode";
import { CostReader, CostMaintenance } from "./database";
import { PricingEngine } from "./pricing";
import { TracesDbReader } from "./parser";
import { TracesIngester } from "./watcher";
import { DashboardPanel, StatusBarIndicator } from "./views";

interface CommandDeps {
  database: CostReader & CostMaintenance;
  pricing: PricingEngine;
  ingester: TracesIngester;
  reader: TracesDbReader;
  statusBar: StatusBarIndicator;
  extensionUri: vscode.Uri;
}

export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  const { database, pricing, ingester, reader, statusBar, extensionUri } = deps;

  const refreshAndUpdate = () => {
    statusBar.update();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("copilotCostTracker.refresh", async () => {
      try {
        await pricing.refreshPricing();
        const count = await ingester.fullIngest();
        await database.save();
        refreshAndUpdate();
        vscode.window.showInformationMessage(`Copilot Cost Tracker: Refreshed. ${count} new turns processed.`);
      } catch (err) {
        vscode.window.showErrorMessage(`Copilot Cost Tracker: Refresh failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("copilotCostTracker.openDashboard", () => {
      DashboardPanel.createOrShow(extensionUri, database, pricing, reader);
    }),

    vscode.commands.registerCommand("copilotCostTracker.scanAll", async () => {
      try {
        const count = await ingester.fullIngest();
        await database.save();
        refreshAndUpdate();
        vscode.window.showInformationMessage(`Copilot Cost Tracker: Full scan complete. ${count} turns processed.`);
      } catch (err) {
        vscode.window.showErrorMessage(`Copilot Cost Tracker: Scan failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("copilotCostTracker.scanFullHistory", async () => {
      try {
        vscode.window.showInformationMessage("Copilot Cost Tracker: Starting full history backfill...");
        const count = await ingester.ingest(0);
        await database.save();
        refreshAndUpdate();
        vscode.window.showInformationMessage(`Copilot Cost Tracker: Full history backfill complete. ${count} turns processed.`);
      } catch (err) {
        vscode.window.showErrorMessage(`Copilot Cost Tracker: History backfill failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("copilotCostTracker.setMonthlyBudget", async () => {
      const items: vscode.QuickPickItem[] = [
        { label: "Pro", description: "300 credits/month", detail: "GitHub Copilot Pro" },
        { label: "Pro+", description: "1,500 credits/month", detail: "GitHub Copilot Pro+" },
        { label: "Business", description: "300 credits/month", detail: "GitHub Copilot Business (per seat)" },
        { label: "Enterprise", description: "1,000 credits/month", detail: "GitHub Copilot Enterprise (per seat)" },
        { label: "Custom", description: "Enter a custom amount", detail: "Set your own monthly credit budget" },
      ];

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "Select your Copilot plan or enter a custom budget",
        title: "Set Monthly Budget",
      });
      if (!picked) return;

      const cfg = vscode.workspace.getConfiguration("copilotCostTracker");
      let credits: number;

      if (picked.label === "Custom") {
        const input = await vscode.window.showInputBox({
          prompt: "Enter your monthly credit budget",
          placeHolder: "e.g., 500",
          validateInput: (v) => {
            const n = Number(v);
            if (!Number.isFinite(n) || n < 0) return "Enter a positive number";
            return undefined;
          },
        });
        if (input == null) return;
        credits = Number(input);
      } else {
        const planMap: Record<string, { plan: string; credits: number }> = {
          "Pro": { plan: "pro", credits: 300 },
          "Pro+": { plan: "pro_plus", credits: 1500 },
          "Business": { plan: "business", credits: 300 },
          "Enterprise": { plan: "enterprise", credits: 1000 },
        };
        const selected = planMap[picked.label]!;
        credits = selected.credits;
        await cfg.update("plan", selected.plan, vscode.ConfigurationTarget.Global);
      }

      await cfg.update("budgetCredits", credits, vscode.ConfigurationTarget.Global);
      refreshAndUpdate();
      vscode.window.showInformationMessage(`Copilot Cost Tracker: Monthly budget set to ${credits} credits.`);
    }),
  );
}
