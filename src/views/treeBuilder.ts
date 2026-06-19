import * as vscode from "vscode";
import { CostReader } from "../database";
import { PricingEngine } from "../pricing";
import { getBillingPeriodStartMs } from "../billing";
import { formatDuration, simplifyModelName } from "./treeViewFormatting";
import { formatAgentName } from "../parser/surfaceLabels";
import { resolveWorkspaceName } from "./helpers/workspaceResolver";

export type TreeItemType =
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
  | "workspaceGroup"
  | "workspace"
  | "empty";

export interface CostTreeItem {
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

export function buildTree(
  database: CostReader,
  pricing: PricingEngine,
  workspaceFilter?: string,
): { items: CostTreeItem[]; referenceModels: string[] } {
  const config = vscode.workspace.getConfiguration("copilotCostTracker");
  const budgetCredits = config.get<number>("budgetCredits", 180);
  const billingCycleStartDay = config.get<number>("billingCycleStartDay", 1);
  const periodStartMs = getBillingPeriodStartMs(billingCycleStartDay);

  const periodTotal = database.getCostSince(periodStartMs, workspaceFilter);

  if (periodTotal.turns === 0) {
    return {
      items: [{
        type: "empty",
        label: "No data yet",
        description: "Chat with Copilot to start tracking",
        tooltip: "Enable debug logging via 'Developer: Open Agent Debug Logs' and use Copilot Chat.",
      }],
      referenceModels: [...REFERENCE_MODELS],
    };
  }

  const items: CostTreeItem[] = [];

  // Budget
  const usedPct = budgetCredits > 0 ? (periodTotal.credits / budgetCredits) * 100 : 0;
  const remainingCredits = budgetCredits - periodTotal.credits;
  const progressBar = makeProgressBar(usedPct);
  let budgetIconColor = 'charts.green';
  if (usedPct > 90) { budgetIconColor = 'charts.red'; }
  else if (usedPct > 75) { budgetIconColor = 'charts.yellow'; }

  const remainingLabel = remainingCredits >= 0 ? "Remaining" : "Overage";
  const remainingAbsCredits = Math.abs(remainingCredits);
  const remainingAbsUsd = creditsToUsdEstimate(remainingAbsCredits);

  const periodModels = database.getModelBreakdownSince(periodStartMs, workspaceFilter);
  const referenceModels = periodModels.length > 0
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
        label: `Used: ${periodTotal.credits.toFixed(0)} cr · ${fmtUsd(periodTotal.costUsd)}`,
        iconId: "arrow-up",
      },
      {
        type: "budgetDetail",
        label: `${remainingLabel}: ${remainingAbsCredits.toFixed(0)} cr · ${fmtUsd(remainingAbsUsd)} (est.)`,
        iconId: "arrow-down",
      },
      {
        type: "budgetDetail",
        label: `Target: ${budgetCredits.toFixed(0)} cr (this period)`,
        iconId: "target",
      },
    ],
  });

  // Today
  const todayData = getTodayData(database, workspaceFilter);
  items.push({
    type: "today",
    label: "Today",
    description: `${fmtUsd(todayData.costUsd)} · ${todayData.credits.toFixed(0)} cr · ${todayData.turns} turns`,
    iconId: "flame",
  });

  // This Week
  const weekData = getWeekData(database, workspaceFilter);
  items.push({
    type: "week",
    label: "This Week",
    description: `${fmtUsd(weekData.costUsd)} · ${weekData.credits.toFixed(0)} cr · ${weekData.turns} turns`,
    iconId: "calendar",
  });

  // This Billing Period
  const dailyCosts = database.getDailyCostsSince(periodStartMs, workspaceFilter);
  items.push({
    type: "month",
    label: "This Billing Period",
    description: `${fmtUsd(periodTotal.costUsd)} · ${periodTotal.credits.toFixed(0)} cr · ${periodTotal.turns} turns`,
    iconId: "calendar",
    hasChildren: dailyCosts.length > 0,
    children: dailyCosts.map((d) => ({
      type: "day" as const,
      label: d.period,
      description: `${fmtUsd(d.totalCostUsd)} · ${d.totalCredits.toFixed(0)} cr · ${d.turnCount} turns`,
      iconId: "circle-small-filled",
    })),
  });

  // Models (this period)
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
        description: `${m.percentage.toFixed(0)}% · ${fmtUsd(m.totalCostUsd)} · ${m.turnCount} turns`,
        iconId: "symbol-method",
      })),
    });
  }

  const periodAgents = database.getAgentBreakdownSince(periodStartMs, workspaceFilter);
  if (periodAgents.length > 0) {
    items.push({
      type: "agentGroup",
      label: "Agents (This Period)",
      description: `${periodAgents.length} active`,
      iconId: "organization",
      hasChildren: true,
      children: periodAgents.map((a) => ({
        type: "agent" as const,
        label: formatAgentName(a.agentName),
        description: `${a.percentage.toFixed(0)}% · ${fmtUsd(a.totalCostUsd)} · ${a.turnCount} turns`,
        tooltip: `Agent: ${a.agentName}`,
        iconId: "symbol-key",
      })),
    });
  }

  // Sessions
  const sessions = database.getSessionSummaries(workspaceFilter, 30);

  // Workspaces (this period)
  const workspaces = database.getWorkspaces();
  if (workspaces.length > 1) {
    const wsBreakdown = workspaces.map((ws) => {
      const wsData = database.getCostSince(periodStartMs, ws);
      return { hash: ws, name: resolveWorkspaceName(ws), ...wsData };
    }).filter((ws) => ws.turns > 0).sort((a, b) => b.credits - a.credits);

    if (wsBreakdown.length > 1) {
      items.push({
        type: "workspaceGroup",
        label: "Workspaces (This Period)",
        description: `${wsBreakdown.length} repos`,
        iconId: "folder-library",
        hasChildren: true,
        children: wsBreakdown.map((ws) => ({
          type: "workspace" as const,
          label: ws.name,
          description: `${ws.credits.toFixed(0)} cr · ${fmtUsd(ws.costUsd)} · ${ws.turns} turns`,
          iconId: "folder",
        })),
      });
    }
  }

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
        const label = s.title ? `${s.title}` : time;
        const timeDesc = s.title ? `${time} · ` : "";
        return {
          type: "session" as const,
          label,
          description: `${timeDesc}${fmtUsd(s.totalCostUsd)} · ${s.turnCount} turns · ${simplifyModelName(s.primaryModel)} · avg ${avgDuration}`,
          sessionId: s.sessionId,
          iconId: "comment-discussion",
          hasChildren: s.turnCount > 0,
        };
      }),
    });
  }

  return { items, referenceModels };
}

export function turnToTreeItem(
  turn: {
    timestamp: number;
    modelFamily: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    credits: number;
    costUsd: number;
    duration: number;
  },
  includeModel: boolean,
  pricing: PricingEngine,
  referenceModels: string[],
): CostTreeItem {
  const time = new Date(turn.timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const duration = formatDuration(turn.duration);
  const modelPrefix = includeModel ? `${simplifyModelName(turn.modelFamily)} · ` : "";

  return {
    type: "turn",
    label: time,
    description: `${modelPrefix}${turn.credits.toFixed(1)} cr · ${duration}`,
    tooltip: buildTurnTooltip(turn, pricing, referenceModels),
    iconId: "hubot",
  };
}

function getTodayData(database: CostReader, workspaceFilter?: string): { costUsd: number; credits: number; turns: number } {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return database.getCostSince(todayStart, workspaceFilter);
}

function getWeekData(database: CostReader, workspaceFilter?: string): { costUsd: number; credits: number; turns: number } {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset).getTime();
  return database.getCostSince(weekStart, workspaceFilter);
}

function makeProgressBar(pct: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
  const empty = 10 - filled;
  return "▰".repeat(filled) + "▱".repeat(empty);
}

function creditsToUsdEstimate(credits: number): number {
  return credits / 100;
}

function fmtUsd(amount: number): string {
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

function buildTurnTooltip(
  turn: {
    modelFamily: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    credits: number;
  },
  pricing: PricingEngine,
  referenceModels: string[],
): string {
  const normalized = turn.modelFamily.toLowerCase();
  const baselineLabel = MODEL_LABELS[normalized] ?? simplifyModelName(turn.modelFamily);
  const alternatives = referenceModels
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
    const altUsd = pricing.calculateCost(
      model,
      turn.inputTokens,
      turn.outputTokens,
      turn.cachedTokens,
      turn.cacheWriteTokens
    );
    const altCredits = pricing.costToCredits(altUsd);
    const label = MODEL_LABELS[model] ?? simplifyModelName(model);
    lines.push(`Would cost ${altCredits.toFixed(1)} cr with ${label}`);
  }

  return lines.join("\n");
}
