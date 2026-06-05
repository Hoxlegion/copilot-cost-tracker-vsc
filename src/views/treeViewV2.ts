import * as vscode from "vscode";
import { CostDatabase } from "../database";
import { PricingEngine } from "../pricing";
import { getBillingPeriodStartMs } from "../billing";
import { formatDuration, simplifyModelName } from "./treeViewFormatting";

type TreeItemType =
  | "budget"
  | "budgetDetail"
  | "today"
  | "week"
  | "month"
  | "day"
  | "session"
  | "turn"
  | "modelGroup"
  | "model"
  | "agentGroup"
  | "agent"
  | "sessionsGroup"
  | "empty";

interface CostTreeItem {
  type: TreeItemType;
  label: string;
  costUsd?: number;
  credits?: number;
  children?: CostTreeItem[];
  description?: string;
  tooltip?: string;
  sessionId?: string;
  iconId?: string;
  iconColor?: string;
  hasChildren?: boolean;
  includeModelInTurns?: boolean;
}

const REFERENCE_MODELS: string[] = ["claude-opus-4.6", "claude-sonnet-4.6", "gpt-5.4"];
const MODEL_LABELS: Record<string, string> = {
  "claude-opus-4.6": "Claude Opus 4.6",
  "claude-sonnet-4.6": "Claude Sonnet 4.6",
  "gpt-5.4": "GPT-5.4",
};

export class CostTreeProvider implements vscode.TreeDataProvider<CostTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<CostTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly database: CostDatabase;
  private readonly pricing: PricingEngine;
  private workspaceFilter?: string;
  private referenceModels: string[] = [...REFERENCE_MODELS];

  constructor(database: CostDatabase, pricing: PricingEngine) {
    this.database = database;
    this.pricing = pricing;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setWorkspaceFilter(workspace?: string): void {
    this.workspaceFilter = workspace;
    this.refresh();
  }

  getTreeItem(element: CostTreeItem): vscode.TreeItem {
    const hasChildren = element.hasChildren ?? Boolean(element.children && element.children.length > 0);
    const collapsible = hasChildren
      ? this.getCollapsibleState(element.type)
      : vscode.TreeItemCollapsibleState.None;

    const item = new vscode.TreeItem(element.label, collapsible);

    item.description = element.description;
    item.tooltip = element.tooltip;

    // Icons
    const iconId = element.iconId ?? this.getDefaultIcon(element.type);
    item.iconPath = element.iconColor
      ? new vscode.ThemeIcon(iconId, new vscode.ThemeColor(element.iconColor))
      : new vscode.ThemeIcon(iconId);

    return item;
  }

  async getChildren(element?: CostTreeItem): Promise<CostTreeItem[]> {
    if (!element) {
      return this.getRootItems();
    }

    if (element.type === "session" && element.sessionId) {
      const turns = this.database.getTurnsForSession(element.sessionId, 20);
      const modelsInSession = new Set(turns.map((t) => t.modelFamily.toLowerCase()));
      const includeModelInTurns = element.includeModelInTurns ?? modelsInSession.size > 1;
      return turns.map((turn) => this.turnToTreeItem(turn, includeModelInTurns));
    }

    return element.children ?? [];
  }

  private getCollapsibleState(type: TreeItemType): vscode.TreeItemCollapsibleState {
    switch (type) {
      case "budget":
      case "month":
        return vscode.TreeItemCollapsibleState.Expanded;
      case "modelGroup":
      case "agentGroup":
      case "sessionsGroup":
      case "session":
        return vscode.TreeItemCollapsibleState.Collapsed;
      default:
        return vscode.TreeItemCollapsibleState.Collapsed;
    }
  }

  private getDefaultIcon(type: TreeItemType): string {
    switch (type) {
      case "budget": return "credit-card";
      case "budgetDetail": return "dash";
      case "today": return "flame";
      case "week": return "calendar";
      case "month": return "calendar";
      case "day": return "circle-small-filled";
      case "session": return "comment-discussion";
      case "turn": return "hubot";
      case "modelGroup": return "symbol-class";
      case "model": return "symbol-method";
      case "agentGroup": return "organization";
      case "agent": return "symbol-key";
      case "sessionsGroup": return "history";
      case "empty": return "info";
    }
  }

  private formatAgentName(agentName: string): string {
    switch (agentName) {
      case "panel/editAgent": return "Inline Chat";
      case "XtabProvider": return "Next Edit Suggestions";
      case "GitHub Copilot Chat": return "Sidebar Chat";
      case "summarizeConversationHistory": return "Context Summarization";
      case "progressMessages": return "Background Processing";
      case "title": return "Title Generation";
      case "unknown":
      case "":
        return "Unknown";
      default:
        return agentName;
    }
  }

  private getRootItems(): CostTreeItem[] {
    const config = vscode.workspace.getConfiguration("copilotCostTracker");
    const budgetCredits = config.get<number>("budgetCredits", 180);
    const billingCycleStartDay = config.get<number>("billingCycleStartDay", 1);
    const periodStartMs = getBillingPeriodStartMs(billingCycleStartDay);

    const periodTotal = this.database.getCostSince(periodStartMs, this.workspaceFilter);

    if (periodTotal.turns === 0) {
      return [{
        type: "empty",
        label: "No data yet",
        description: "Chat with Copilot to start tracking",
        tooltip: "Enable debug logging via 'Developer: Open Agent Debug Logs' and use Copilot Chat.",
      }];
    }

    const items: CostTreeItem[] = [];

    // ━━ Budget ━━
    const usedPct = budgetCredits > 0 ? (periodTotal.credits / budgetCredits) * 100 : 0;
    const remainingCredits = budgetCredits - periodTotal.credits;
    const progressBar = this.makeProgressBar(usedPct);
    let budgetIconColor = 'charts.green';
    if (usedPct > 90) { budgetIconColor = 'charts.red'; }
    else if (usedPct > 75) { budgetIconColor = 'charts.yellow'; }

    const remainingLabel = remainingCredits >= 0 ? "Remaining" : "Overage";
    const remainingAbsCredits = Math.abs(remainingCredits);
    const remainingAbsUsd = this.creditsToUsdEstimate(remainingAbsCredits);

    const periodModels = this.database.getModelBreakdownSince(periodStartMs, this.workspaceFilter);
    this.referenceModels = periodModels.length > 0
      ? periodModels.slice(0, 3).map((m) => m.model.toLowerCase())
      : [...REFERENCE_MODELS];

    items.push({
      type: "budget",
      label: "Budget",
      description: `${progressBar} ${usedPct.toFixed(0)}%`,
      iconId: "credit-card",
      iconColor: budgetIconColor,
      hasChildren: true,
      children: [
        {
          type: "budgetDetail",
          label: `Used: ${periodTotal.credits.toFixed(0)} cr · ${this.fmtUsd(periodTotal.costUsd)}`,
          iconId: "arrow-up",
        },
        {
          type: "budgetDetail",
          label: `${remainingLabel}: ${remainingAbsCredits.toFixed(0)} cr · ${this.fmtUsd(remainingAbsUsd)} (est.)`,
          iconId: "arrow-down",
        },
        {
          type: "budgetDetail",
          label: `Target: ${budgetCredits.toFixed(0)} cr (this period)`,
          iconId: "target",
        },
      ],
    });

    // ━━ Today ━━
    const todayData = this.getTodayData();
    items.push({
      type: "today",
      label: "Today",
      description: `${this.fmtUsd(todayData.costUsd)} · ${todayData.credits.toFixed(0)} cr · ${todayData.turns} turns`,
      iconId: "flame",
    });

    // ━━ This Week ━━
    const weekData = this.getWeekData();
    items.push({
      type: "week",
      label: "This Week",
      description: `${this.fmtUsd(weekData.costUsd)} · ${weekData.credits.toFixed(0)} cr · ${weekData.turns} turns`,
      iconId: "calendar",
    });

    // ━━ This Billing Period ━━
    const dailyCosts = this.database.getDailyCostsSince(periodStartMs, this.workspaceFilter);
    items.push({
      type: "month",
      label: "This Billing Period",
      description: `${this.fmtUsd(periodTotal.costUsd)} · ${periodTotal.credits.toFixed(0)} cr · ${periodTotal.turns} turns`,
      iconId: "calendar",
      hasChildren: dailyCosts.length > 0,
      children: dailyCosts.map((d) => ({
        type: "day" as const,
        label: d.period,
        description: `${this.fmtUsd(d.totalCostUsd)} · ${d.totalCredits.toFixed(0)} cr · ${d.turnCount} turns`,
        iconId: "circle-small-filled",
      })),
    });

    // ━━ Models (this period) ━━
    if (periodModels.length > 0) {
      items.push({
        type: "modelGroup",
        label: "Models (This Period)",
        description: `${periodModels.length} active`,
        iconId: "symbol-class",
        hasChildren: true,
        children: periodModels.map((m) => ({
          type: "model" as const,
          label: simplifyModelName(m.model),
          description: `${m.percentage.toFixed(0)}% · ${this.fmtUsd(m.totalCostUsd)} · ${m.turnCount} turns`,
          iconId: "symbol-method",
        })),
      });
    }

    const periodAgents = this.database.getAgentBreakdownSince(periodStartMs, this.workspaceFilter);
    if (periodAgents.length > 0) {
      items.push({
        type: "agentGroup",
        label: "Agents (This Period)",
        description: `${periodAgents.length} active`,
        iconId: "organization",
        hasChildren: true,
        children: periodAgents.map((a) => ({
          type: "agent" as const,
          label: this.formatAgentName(a.agentName),
          description: `${a.percentage.toFixed(0)}% · ${this.fmtUsd(a.totalCostUsd)} · ${a.turnCount} turns`,
          tooltip: `Agent: ${a.agentName}`,
          iconId: "symbol-key",
        })),
      });
    }

    // ━━ Sessions ━━
    const sessions = this.database.getSessionSummaries(this.workspaceFilter, 30);
    if (sessions.length > 0) {
      items.push({
        type: "sessionsGroup",
        label: "Sessions (Recent)",
        description: `${sessions.length} recent`,
        iconId: "history",
        hasChildren: true,
        children: sessions.map((s) => {
          const time = new Date(s.startTimestamp).toLocaleString(undefined, {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
          });
          const avgDuration = formatDuration(s.avgDurationMs);
          return {
            type: "session" as const,
            label: time,
            description: `${this.fmtUsd(s.totalCostUsd)} · ${s.turnCount} turns · ${simplifyModelName(s.primaryModel)} · avg ${avgDuration}`,
            sessionId: s.sessionId,
            iconId: "comment-discussion",
            hasChildren: s.turnCount > 0,
          };
        }),
      });
    }

    return items;
  }

  private getTodayData(): { costUsd: number; credits: number; turns: number } {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return this.database.getCostSince(todayStart, this.workspaceFilter);
  }

  private getWeekData(): { costUsd: number; credits: number; turns: number } {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset).getTime();
    return this.database.getCostSince(weekStart, this.workspaceFilter);
  }

  private makeProgressBar(pct: number): string {
    const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
    const empty = 10 - filled;
    return "▰".repeat(filled) + "▱".repeat(empty);
  }

  private creditsToUsdEstimate(credits: number): number {
    return credits / 100;
  }

  private fmtUsd(amount: number): string {
    const config = vscode.workspace.getConfiguration("copilotCostTracker");
    const currency = config.get<string>("currency", "USD");
    const exchangeRate = config.get<number>("exchangeRate", 1);

    if (currency === "USD") {
      return `$${amount.toFixed(2)}`;
    }

    const localAmount = amount * exchangeRate;
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(localAmount);
    } catch {
      return `${currency} ${localAmount.toFixed(2)}`;
    }
  }

  private turnToTreeItem(turn: {
    timestamp: number;
    modelFamily: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    credits: number;
    costUsd: number;
    duration: number;
  }, includeModel: boolean): CostTreeItem {
    const time = new Date(turn.timestamp).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const duration = formatDuration(turn.duration);
    const modelPrefix = includeModel ? `${simplifyModelName(turn.modelFamily)} · ` : "";

    return {
      type: "turn",
      label: time,
      description: `${modelPrefix}${turn.credits.toFixed(1)} cr · ${duration}`,
      tooltip: this.buildTurnTooltip(turn),
      iconId: "hubot",
    };
  }

  private buildTurnTooltip(turn: {
    modelFamily: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    credits: number;
  }): string {
    const normalized = turn.modelFamily.toLowerCase();
    const baselineLabel = MODEL_LABELS[normalized] ?? simplifyModelName(turn.modelFamily);
    const alternatives = this.referenceModels
      .filter((model) => model !== normalized)
      .slice(0, 2);

    const fallbackAlternatives = REFERENCE_MODELS
      .filter((model) => model !== normalized)
      .slice(0, 2);

    const candidateModels = alternatives.length > 0 ? alternatives : fallbackAlternatives;
    const lines: string[] = [
      `This turn cost ${turn.credits.toFixed(1)} cr (${baselineLabel}).`,
    ];

    for (const model of candidateModels) {
      const altUsd = this.pricing.calculateCost(
        model,
        turn.inputTokens,
        turn.outputTokens,
        turn.cachedTokens,
        turn.cacheWriteTokens
      );
      const altCredits = this.pricing.costToCredits(altUsd);
      const label = MODEL_LABELS[model] ?? simplifyModelName(model);
      lines.push(`Would cost ${altCredits.toFixed(1)} cr with ${label}`);
    }

    return lines.join("\n");
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
