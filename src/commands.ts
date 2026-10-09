import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as vscode from "vscode";
import { CostReader, CostMaintenance, StoredTurn } from "./database";
import { PricingEngine } from "./pricing";
import { TracesDbReader } from "./parser";
import { TracesIngester } from "./watcher";
import { ConfigManager } from "./config";
import { DashboardPanel, StatusBarIndicator } from "./views";

interface CommandDeps {
  database: CostReader & CostMaintenance;
  pricing: PricingEngine;
  ingester: TracesIngester;
  reader: TracesDbReader;
  statusBar: StatusBarIndicator;
  configManager: ConfigManager;
  extensionUri: vscode.Uri;
}

export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  const { database, pricing, ingester, reader, statusBar, configManager, extensionUri } = deps;

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
        vscode.window.showInformationMessage(`Copilot Cost Tracker: Refreshed. ${count} new or updated turns.`);
      } catch (err) {
        vscode.window.showErrorMessage(`Copilot Cost Tracker: Refresh failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("copilotCostTracker.openDashboard", () => {
      DashboardPanel.createOrShow(extensionUri, database, pricing, reader, configManager);
    }),

    vscode.commands.registerCommand("copilotCostTracker.scanAll", async () => {
      try {
        const count = await ingester.fullIngest();
        await database.save();
        refreshAndUpdate();
        vscode.window.showInformationMessage(`Copilot Cost Tracker: Full scan complete. ${count} new or updated turns.`);
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
        vscode.window.showInformationMessage(`Copilot Cost Tracker: Full history backfill complete. ${count} new or updated turns.`);
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
        const selected = planMap[picked.label];
        credits = selected.credits;
        await cfg.update("plan", selected.plan, vscode.ConfigurationTarget.Global);
      }

      await cfg.update("budgetCredits", credits, vscode.ConfigurationTarget.Global);
      refreshAndUpdate();
      vscode.window.showInformationMessage(`Copilot Cost Tracker: Monthly budget set to ${credits} credits.`);
    }),

    vscode.commands.registerCommand("copilotCostTracker.exportData", async () => {
      try {
        const format = await vscode.window.showQuickPick(
          [
            { label: "JSON", description: "Structured JSON array of all turns" },
            { label: "CSV", description: "Comma-separated values for spreadsheets" },
          ],
          { placeHolder: "Select export format", title: "Export Usage Data" },
        );
        if (!format) return;

        const isCsv = format.label === "CSV";
        const ext = isCsv ? "csv" : "json";
        const stamp = new Date().toISOString().slice(0, 10);
        const target = await vscode.window.showSaveDialog({
          title: "Export Usage Data",
          saveLabel: "Export",
          defaultUri: vscode.Uri.file(`copilot-cost-export-${stamp}.${ext}`),
          filters: isCsv ? { "CSV files": ["csv"] } : { "JSON files": ["json"] },
        });
        if (!target) return;

        if (target.scheme !== "file") {
          throw new Error("Export requires a local file destination.");
        }

        const headers: (keyof StoredTurn)[] = [
          "id", "sessionId", "timestamp", "duration", "agentName", "model", "modelFamily",
          "inputTokens", "outputTokens", "cachedTokens", "cacheWriteTokens", "totalTokens",
          "costUsd", "credits", "workspace", "status", "costSource",
        ];
        const escape = (value: string | number): string => {
          const text = value == null ? "" : String(value);
          const safe = typeof value === "string" && /^\s*[=+\-@]/.test(value) ? `'${text}` : text;
          return safe !== text || /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
        };
        let count = 0;
        function* chunks(): Generator<string> {
          yield isCsv ? headers.join(",") : "[";
          for (const turn of database.iterateAllTurns()) {
            if (isCsv) {
              yield `\r\n${headers.map((header) => escape(turn[header])).join(",")}`;
            } else {
              yield `${count === 0 ? "\n  " : ",\n  "}${JSON.stringify(turn, null, 2).replaceAll("\n", "\n  ")}`;
            }
            count++;
          }
          if (!isCsv) yield count === 0 ? "]" : "\n]";
        }

        const tempPath = path.join(path.dirname(target.fsPath), `.${path.basename(target.fsPath)}.${randomUUID()}.tmp`);
        try {
          await pipeline(Readable.from(chunks()), createWriteStream(tempPath, { encoding: "utf8", flags: "wx" }));
          await rename(tempPath, target.fsPath);
        } finally {
          await rm(tempPath, { force: true });
        }
        vscode.window.showInformationMessage(
          `Copilot Cost Tracker: Exported ${count} turns to ${target.fsPath}`,
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Copilot Cost Tracker: Export failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
}
