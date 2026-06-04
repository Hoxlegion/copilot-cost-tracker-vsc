import * as vscode from "vscode";
import { CostDatabase } from "../database";
import { PricingEngine } from "../pricing";
import { ConfigManager, ExtensionConfig } from "../config";
import { getBillingPeriodStartMs } from "../billing";
import { Logger } from "../logger";

export class StatusBarIndicator implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly database: CostDatabase;
  private readonly pricing: PricingEngine;
  private readonly configManager: ConfigManager;
  private readonly logger: Logger;
  private visible: boolean = false;
  private readonly commandDisposable: vscode.Disposable;

  // Session delta tracking (D14): credits since extension activation
  private readonly activationTimestamp: number;

  // Budget alert tracking (D8): which thresholds have fired this period
  private readonly firedThresholds: Set<number> = new Set();
  private lastBillingPeriodStartMs: number = 0;

  constructor(
    database: CostDatabase,
    pricing: PricingEngine,
    configManager: ConfigManager,
    logger: Logger
  ) {
    this.database = database;
    this.pricing = pricing;
    this.configManager = configManager;
    this.logger = logger;
    this.activationTimestamp = Date.now();

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = "copilotCostTracker.statusBarClick";
    this.statusBarItem.tooltip = "Click for Copilot Cost options";

    this.commandDisposable = vscode.commands.registerCommand(
      "copilotCostTracker.statusBarClick",
      () => this.showQuickPick()
    );

    this.updateVisibility();
  }

  private async showQuickPick(): Promise<void> {
    const cfg = this.configManager.config;
    const periodStartMs = getBillingPeriodStartMs(cfg.billingCycleStartDay);
    const periodCredits = this.database.getCreditsSince(periodStartMs);
    const budget = cfg.budgetCredits;
    const pct = budget > 0 ? ((periodCredits / budget) * 100).toFixed(1) : "0";

    const models = this.database.getModelBreakdown(30);

    const items: vscode.QuickPickItem[] = [
      {
        label: `$(graph) ${periodCredits.toFixed(1)}/${budget} credits (${pct}%)`,
        description: "This billing period",
      },
      { label: "", kind: vscode.QuickPickItemKind.Separator },
    ];

    for (const m of models.slice(0, 5)) {
      items.push({
        label: `$(hubot) ${m.model}`,
        description: `${m.totalCredits.toFixed(1)} cr · $${m.totalCostUsd.toFixed(3)}`,
        detail: `  ${m.turnCount} turns · ${m.percentage.toFixed(0)}% of total`,
      });
    }

    items.push(
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      { label: "$(dashboard) Open Dashboard", description: "Full cost breakdown" },
      { label: "$(refresh) Refresh Data", description: "Scan for new turns" },
      { label: "$(gear) Settings", description: "Configure tracker" },
      { label: "$(list-tree) Show TreeView", description: "Focus sidebar panel" }
    );

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Copilot Cost Tracker",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!picked) {return;}

    if (picked.label.includes("Open Dashboard")) {
      vscode.commands.executeCommand("copilotCostTracker.openDashboard");
    } else if (picked.label.includes("Refresh Data")) {
      vscode.commands.executeCommand("copilotCostTracker.refresh");
    } else if (picked.label.includes("Settings")) {
      vscode.commands.executeCommand("workbench.action.openSettings", "copilotCostTracker");
    } else if (picked.label.includes("Show TreeView")) {
      vscode.commands.executeCommand("copilotCostTracker.overview.focus");
    }
  }

  /**
   * Update the status bar with session + period totals in USD (D15).
   * Checks budget thresholds and updates color (D8).
   */
  update(): void {
    if (!this.visible) {return;}

    const cfg = this.configManager.config;
    const periodStartMs = getBillingPeriodStartMs(cfg.billingCycleStartDay);

    // Session and period totals
    const sessionTotals = this.database.getCostSince(this.activationTimestamp);
    const periodTotals = this.database.getCostSince(periodStartMs);
    const sessionUsd = sessionTotals.costUsd;
    const periodUsd = periodTotals.costUsd;
    const periodCredits = periodTotals.credits;

    // Format: session USD | period total USD
    const text = `$(credit-card) +$${sessionUsd.toFixed(2)} | $${periodUsd.toFixed(2)}`;
    this.statusBarItem.text = text;

    // Color coding based on budget thresholds (D8)
    this.updateColor(periodCredits, cfg);

    // Check and fire threshold notifications (D8)
    this.checkThresholds(periodCredits, periodStartMs, cfg);

    // Tooltip
    const budget = cfg.budgetCredits;
    const pct = budget > 0 ? ((periodCredits / budget) * 100).toFixed(1) : "—";
    const tooltip = new vscode.MarkdownString("", false);
    tooltip.isTrusted = false;
    tooltip.appendMarkdown(`**Copilot Cost Tracker**\n\n`);
    tooltip.appendMarkdown(`Session: **+$${sessionUsd.toFixed(2)}** (${sessionTotals.credits.toFixed(2)} credits)\n\n`);
    tooltip.appendMarkdown(`Period: **$${periodUsd.toFixed(2)}** · ${periodCredits.toFixed(2)} / ${budget} credits (${pct}%)\n\n`);
    tooltip.appendMarkdown(`*Click for options*`);
    this.statusBarItem.tooltip = tooltip;
  }

  /**
   * Update status bar color based on budget thresholds.
   */
  private updateColor(periodCredits: number, cfg: ExtensionConfig): void {
    const budget = cfg.budgetCredits;
    if (budget <= 0) {
      this.statusBarItem.backgroundColor = undefined;
      return;
    }

    const pct = (periodCredits / budget) * 100;
    const thresholds = cfg.budgetWarningThresholds;

    // Find the highest crossed threshold
    const crossedThresholds = thresholds.filter((t) => pct >= t);

    if (crossedThresholds.length === 0) {
      // Under all thresholds — normal (no color)
      this.statusBarItem.backgroundColor = undefined;
    } else {
      const highest = crossedThresholds.at(-1) ?? 0;
      if (highest >= 100) {
        // Over budget — error red
        this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      } else {
        // Warning — yellow
        this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      }
    }
  }

  /**
   * Check thresholds and fire one-time notifications (D8).
   */
  private checkThresholds(periodCredits: number, periodStartMs: number, cfg: ExtensionConfig): void {
    const budget = cfg.budgetCredits;
    if (budget <= 0) { return; }

    // Reset fired thresholds if billing period changed
    if (periodStartMs !== this.lastBillingPeriodStartMs) {
      this.firedThresholds.clear();
      this.lastBillingPeriodStartMs = periodStartMs;
    }

    const pct = (periodCredits / budget) * 100;

    for (const threshold of cfg.budgetWarningThresholds) {
      if (pct >= threshold && !this.firedThresholds.has(threshold)) {
        this.firedThresholds.add(threshold);
        const message = threshold >= 100
          ? `Copilot Cost Tracker: You've reached ${pct.toFixed(0)}% of your ${budget} credit budget.`
          : `Copilot Cost Tracker: ${threshold}% budget warning — ${periodCredits.toFixed(1)}/${budget} credits used.`;
        vscode.window.showWarningMessage(message);
        this.logger.warn(message);
      }
    }
  }

  /**
   * Check configuration and show/hide accordingly.
   */
  updateVisibility(): void {
    this.visible = this.configManager.config.showStatusBar;

    if (this.visible) {
      this.update();
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  dispose(): void {
    this.statusBarItem.dispose();
    this.commandDisposable.dispose();
  }
}
