import { CostDatabase, CacheSavingsMetrics, InsightMetrics } from "../database";
import { PricingEngine } from "../pricing";
import type { SurfaceBreakdown } from "../parser";
import type { DashboardAlert } from "../insights";
import type { UnknownModelDiagnostics } from "../pricing";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

export function createNonce(length: number = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < length; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(p * sortedValues.length) - 1));
  return Math.round(sortedValues[idx]);
}

export function computeModelLatencyRows(
  database: CostDatabase,
  days: number = 30,
): Array<{ model: string; avgMs: number; tailMs: number; tailLabel: string; tailHint: string }> {
  const samples = database.getModelLatencySamples(days);
  const grouped = new Map<string, number[]>();

  for (const sample of samples) {
    const values = grouped.get(sample.model) ?? [];
    values.push(sample.duration);
    grouped.set(sample.model, values);
  }

  const rows: Array<{ model: string; avgMs: number; tailMs: number; tailLabel: string; tailHint: string }> = [];
  for (const [model, values] of grouped.entries()) {
    values.sort((a, b) => a - b);
    const avgMs = Math.round(values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length));

    if (values.length < 5) {
      rows.push({ model, avgMs, tailMs: 0, tailLabel: "-", tailHint: "Tail metric hidden: requires at least 5 turns." });
    } else if (values.length < 20) {
      rows.push({ model, avgMs, tailMs: percentile(values, 0.5), tailLabel: "P50", tailHint: "P50 (median) shown due to low sample size (<20 turns)." });
    } else {
      rows.push({ model, avgMs, tailMs: percentile(values, 0.9), tailLabel: "P90", tailHint: "P90 shown (sample size >=20 turns)." });
    }
  }
  return rows;
}

export function getUsagePresentation(periodCredits: number, budgetCredits: number): { usagePct: string } {
  const usagePct = budgetCredits > 0 ? ((periodCredits / budgetCredits) * 100).toFixed(1) : "0";
  return { usagePct };
}

export function getBudgetDetails(
  periodStartMs: number,
  periodEndMs: number,
  periodTurns: number,
  periodCredits: number,
  budgetCredits: number,
): {
  daysRemaining: number;
  dailyBudgetRemaining: string;
  burnRate: number;
  projectedPeriodCredits: number;
  forecastVisible: boolean;
  forecastOverage: number;
} {
  const daysRemaining = Math.max(0, Math.ceil((periodEndMs - Date.now()) / (24 * 60 * 60 * 1000)));
  const dailyBudgetRemaining = daysRemaining > 0 ? ((budgetCredits - periodCredits) / daysRemaining).toFixed(1) : "0";
  const msInDay = 24 * 60 * 60 * 1000;
  const totalDaysInPeriod = Math.max(1, Math.ceil((periodEndMs - periodStartMs) / msInDay));
  const daysSincePeriodStart = Math.max(1, Math.ceil((Date.now() - periodStartMs) / msInDay));
  const burnRate = periodCredits / daysSincePeriodStart;
  const projectedPeriodCredits = burnRate * totalDaysInPeriod;
  const forecastVisible = periodTurns >= 50 || periodCredits >= 0.5;
  const forecastOverage = projectedPeriodCredits - budgetCredits;
  return { daysRemaining, dailyBudgetRemaining, burnRate, projectedPeriodCredits, forecastVisible, forecastOverage };
}

export function buildInsightViewData(insightMetrics: InsightMetrics): { totalBillableInput30d: number; avgInputPerTurn: number } {
  const totalBillableInput30d = insightMetrics.totalInputTokens + insightMetrics.totalCachedTokens;
  const avgInputPerTurn = insightMetrics.totalTurns > 0
    ? Math.round(totalBillableInput30d / insightMetrics.totalTurns / 100) / 10
    : 0;
  return { totalBillableInput30d, avgInputPerTurn };
}

export function buildSurfaceCostView(
  agentBreakdown: Array<{ agentName: string; totalCostUsd: number; totalCredits: number; turnCount: number; percentage: number }>,
  agentLabelMap: Record<string, string>,
): Array<{ label: string; costUsd: number; credits: number; turnCount: number; pct: number }> {
  const totalCost = agentBreakdown.reduce((sum, r) => sum + r.totalCostUsd, 0);
  return agentBreakdown.filter((r) => r.totalCostUsd > 0).map((r) => ({
    label: agentLabelMap[r.agentName] ?? r.agentName ?? "Other",
    costUsd: r.totalCostUsd,
    credits: r.totalCredits,
    turnCount: r.turnCount,
    pct: totalCost > 0 ? (r.totalCostUsd / totalCost) * 100 : 0,
  }));
}

export function buildCacheSavingsView(
  cacheSavings: CacheSavingsMetrics,
  periodCostUsd: number,
  pricing: PricingEngine,
): {
  hasSavings: boolean;
  savingsCostUsd: string;
  savingsCredits: string;
  savingsPct: string;
  topModelRows: string;
} {
  let totalSavingsCostUsd = 0;
  for (const entry of cacheSavings.byModel) {
    const cost = pricing.calculateCacheSavingsCost(entry.modelFamily, entry.cacheWriteTokens, entry.cacheReadTokens);
    entry.savingsCostUsd = cost;
    entry.savingsCredits = cost * 100;
    totalSavingsCostUsd += cost;
  }

  cacheSavings.totalSavingsCostUsd = totalSavingsCostUsd;
  cacheSavings.totalSavingsCredits = totalSavingsCostUsd * 100;

  for (const entry of cacheSavings.byModel) {
    entry.percentage = totalSavingsCostUsd > 0 ? (entry.savingsCostUsd / totalSavingsCostUsd) * 100 : 0;
  }

  const savingsPct = periodCostUsd > 0 && totalSavingsCostUsd > 0
    ? ((totalSavingsCostUsd / (periodCostUsd + totalSavingsCostUsd)) * 100).toFixed(1)
    : "0.0";

  const topModels = cacheSavings.byModel.filter((e) => e.savingsCostUsd > 0).slice(0, 6);
  const topModelRows = topModels
    .map((e) => `<tr><td>${e.modelFamily}</td><td class="num">${e.percentage.toFixed(0)}%</td><td class="num">$${e.savingsCostUsd.toFixed(3)}</td></tr>`)
    .join("");

  return {
    hasSavings: totalSavingsCostUsd > 0,
    savingsCostUsd: totalSavingsCostUsd.toFixed(3),
    savingsCredits: (totalSavingsCostUsd * 100).toFixed(1),
    savingsPct,
    topModelRows,
  };
}

export function buildWorkspaceSummaryView(allSessions: Array<{
  sessionId: string;
  workspace: string;
  lastTimestamp: number;
  turnCount: number;
  totalCostUsd: number;
  totalCredits: number;
}>): {
  topWorkspaceLabel: string;
  topWorkspaceCostUsd: number;
  topWorkspaceSessions: number;
  workspaceRowsHtml: string;
  lastUpdatedMs: number;
} {
  const byWorkspace = new Map<string, {
    workspace: string; displayName: string; costUsd: number; credits: number; sessions: number; turns: number; lastTimestamp: number;
  }>();

  let lastUpdatedMs = 0;
  for (const s of allSessions) {
    const key = s.workspace || "unknown";
    const current = byWorkspace.get(key) ?? {
      workspace: key, displayName: resolveWorkspaceName(key), costUsd: 0, credits: 0, sessions: 0, turns: 0, lastTimestamp: 0,
    };
    current.costUsd += s.totalCostUsd;
    current.credits += s.totalCredits;
    current.sessions += 1;
    current.turns += s.turnCount;
    current.lastTimestamp = Math.max(current.lastTimestamp, s.lastTimestamp || 0);
    byWorkspace.set(key, current);
    lastUpdatedMs = Math.max(lastUpdatedMs, s.lastTimestamp || 0);
  }

  const rows = Array.from(byWorkspace.values()).sort((a, b) => b.costUsd - a.costUsd).slice(0, 6);
  const top = rows[0];

  const workspaceRowsHtml = rows.length === 0
    ? `<tr><td colspan="5" style="color:var(--muted)">No workspace data yet</td></tr>`
    : rows.map((r) =>
      `<tr>
        <td title="${r.workspace}">${r.displayName}</td>
        <td class="num">$${r.costUsd.toFixed(3)}</td>
        <td class="num">${r.credits.toFixed(1)}</td>
        <td class="num">${r.sessions}</td>
        <td class="num">${r.turns}</td>
      </tr>`
    ).join("");

  return {
    topWorkspaceLabel: top ? top.displayName : "—",
    topWorkspaceCostUsd: top?.costUsd ?? 0,
    topWorkspaceSessions: top?.sessions ?? 0,
    workspaceRowsHtml,
    lastUpdatedMs,
  };
}

export function buildRecentSessionRowsHtml(allSessions: Array<{
  sessionId: string; workspace: string; lastTimestamp: number; turnCount: number;
  primaryModel: string; totalInputTokens: number; totalCachedTokens: number; totalCostUsd: number;
}>): string {
  const recent = [...allSessions].sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0)).slice(0, 6);
  if (recent.length === 0) return `<tr><td colspan="7" style="color:var(--muted)">No recent sessions yet</td></tr>`;

  return recent.map((s) => {
    const cacheBase = s.totalInputTokens + s.totalCachedTokens;
    const cacheHitPct = cacheBase > 0 ? (s.totalCachedTokens / cacheBase) * 100 : 0;
    const shortSession = s.sessionId.length > 12 ? `${s.sessionId.slice(0, 6)}…${s.sessionId.slice(-4)}` : s.sessionId;
    const timeLabel = s.lastTimestamp > 0 ? new Date(s.lastTimestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
    return `<tr>
      <td>${timeLabel}</td>
      <td title="${s.workspace}">${resolveWorkspaceName(s.workspace)}</td>
      <td title="${s.sessionId}"><button class="goto-session" data-session-id="${s.sessionId}" style="background:none;border:none;color:var(--accent);cursor:pointer;padding:0">${shortSession}</button></td>
      <td>${s.primaryModel || "unknown"}</td>
      <td class="num">${s.turnCount}</td>
      <td class="num">${cacheHitPct.toFixed(1)}%</td>
      <td class="num">$${s.totalCostUsd.toFixed(3)}</td>
    </tr>`;
  }).join("");
}

export function formatFreshnessLabel(lastUpdatedMs: number): string {
  if (!lastUpdatedMs || !Number.isFinite(lastUpdatedMs)) return "no data";
  const diffMs = Math.max(0, Date.now() - lastUpdatedMs);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function shortenWorkspaceName(workspace: string): string {
  if (!workspace) return "unknown";
  const normalized = workspace.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  const tail = parts.slice(-2).join("/") || normalized;
  return tail.length > 34 ? `${tail.slice(0, 31)}…` : tail;
}

function resolveWorkspaceName(hash: string): string {
  if (!hash || hash === "unknown") return hash || "unknown";
  if (hash.includes("/") || hash.includes("\\")) return shortenWorkspaceName(hash);

  try {
    const platform = os.platform();
    let storagePath: string;
    if (platform === "win32") {
      storagePath = path.join(os.homedir(), "AppData", "Roaming", "Code", "User", "workspaceStorage", hash, "workspace.json");
    } else if (platform === "darwin") {
      storagePath = path.join(os.homedir(), "Library", "Application Support", "Code", "User", "workspaceStorage", hash, "workspace.json");
    } else {
      storagePath = path.join(os.homedir(), ".config", "Code", "User", "workspaceStorage", hash, "workspace.json");
    }

    if (!fs.existsSync(storagePath)) return hash.slice(0, 12) + "…";

    const raw = JSON.parse(fs.readFileSync(storagePath, "utf-8")) as Record<string, unknown>;
    const folder = (raw.folder as string) ?? "";
    if (!folder) return hash.slice(0, 12) + "…";

    const decoded = decodeURIComponent(folder)
      .replace(/^[a-z][a-z0-9+\-.]*:\/+/i, "")
      .replaceAll("\\", "/");
    const parts = decoded.split("/").filter(Boolean);
    const tail = parts.slice(-2).join("/") || decoded;
    return tail.length > 34 ? `${tail.slice(0, 31)}…` : tail;
  } catch {
    return hash.slice(0, 12) + "…";
  }
}

export function buildEstimateData(insightMetrics: InsightMetrics, monthCostUsd: number): {
  estHoursSaved: string; costPerOutputK: string; outputTokensK: string; inputOverheadPct: string;
} {
  const charsPerToken = 4;
  const charsPerMinute = 175;
  const maxMinsPerTurn = 2;
  const outputChars30d = insightMetrics.totalOutputTokens * charsPerToken;
  const rawMinutesSaved = outputChars30d / charsPerMinute;
  const cappedMinutesSaved = Math.min(rawMinutesSaved, insightMetrics.totalTurns * maxMinsPerTurn);
  const estHoursSaved = (cappedMinutesSaved / 60).toFixed(1);
  const costPerOutputK = insightMetrics.totalOutputTokens >= 1000
    ? (monthCostUsd / (insightMetrics.totalOutputTokens / 1000)).toFixed(3)
    : "—";
  const outputTokensK = (insightMetrics.totalOutputTokens / 1000).toFixed(1);
  const totalIn = insightMetrics.totalInputTokens + insightMetrics.totalCachedTokens;
  const totalAll = totalIn + insightMetrics.totalOutputTokens;
  const inputOverheadPct = totalAll > 0 ? Math.round((totalIn / totalAll) * 100).toString() : "0";
  return { estHoursSaved, costPerOutputK, outputTokensK, inputOverheadPct };
}

export function getInsightStyles(insightMetrics: InsightMetrics, totalBillableInput30d: number, avgInputPerTurn: number): {
  cacheHitColor: string; avgInputStyle: string; avgInputNote: string; errorStyle: string; errorNote: string; ioRatioLabel: string;
} {
  let cacheHitColor = "#e57373";
  if (insightMetrics.cacheHitPct >= 70) { cacheHitColor = "#81c784"; }
  else if (insightMetrics.cacheHitPct >= 40) { cacheHitColor = "#ffb74d"; }

  const avgInputStyle = avgInputPerTurn > 20 ? "color:#e57373" : "";
  const avgInputNote = avgInputPerTurn > 20 ? "⚠ Context bloat — consider reducing attached files" : "within normal range";
  const errorStyle = insightMetrics.errorTurns > 0 ? "color:#e57373" : "";
  const errorNote = insightMetrics.totalTurns > 0
    ? `${((insightMetrics.errorTurns / insightMetrics.totalTurns) * 100).toFixed(1)}% of total turns`
    : "no data";
  const ioRatioLabel = insightMetrics.totalOutputTokens > 0
    ? `${Math.round(totalBillableInput30d / insightMetrics.totalOutputTokens)}:1`
    : "—:1";
  return { cacheHitColor, avgInputStyle, avgInputNote, errorStyle, errorNote, ioRatioLabel };
}

export function getMeaningfulSurfaces(surfaceData: SurfaceBreakdown[]): SurfaceBreakdown[] {
  const skipSurfaces = new Set(["Background Processing", "Title Generation"]);
  return surfaceData.filter((surface) => surface.inputTokens > 0 && !skipSurfaces.has(surface.label));
}

export function buildAlertCardsHtml(alerts: DashboardAlert[]): string {
  if (alerts.length === 0) {
    return `<div style="padding:10px 12px;background:var(--card-bg);border:1px solid var(--border);border-radius:4px;font-size:12px;color:var(--muted)">
         ✅ No active alerts — your token usage habits look efficient today.
       </div>`;
  }

  const severityColors: Record<string, string> = { info: "#4fc3f7", warning: "#ffb74d", critical: "#e57373" };

  return alerts
    .map((alert) => {
      const borderColor = severityColors[alert.severity] ?? "#888";
      return `<div style="padding:10px 14px;background:var(--card-bg);border:1px solid ${borderColor};border-left:3px solid ${borderColor};border-radius:4px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
            <strong style="font-size:12px">${alert.title}</strong>
            <span style="font-size:11px;color:var(--muted)">${alert.metric.label}: <strong>${alert.metric.value}</strong></span>
          </div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:6px">${alert.message}</div>
          <div style="font-size:11px;background:var(--bg);border-radius:3px;padding:6px 8px;border:1px solid var(--border)">
            💡 <strong>Tip:</strong> ${alert.tip}
          </div>
        </div>`;
    })
    .join("\n");
}

export function buildModelPeriodData(
  database: CostDatabase,
  days: number,
): Array<{ model: string; cost: number; credits: number; turns: number; pct: number; avgMs: number; tailMs: number; tailLabel: string }> {
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const breakdown = database.getModelBreakdownSince(sinceMs);
  const latencyRows = computeModelLatencyRows(database, days);
  const latencyMap = new Map(latencyRows.map((r) => [r.model, r]));
  return breakdown.map((m) => {
    const lat = latencyMap.get(m.model) ?? { avgMs: 0, tailMs: 0, tailLabel: "-" };
    return { model: m.model, cost: m.totalCostUsd, credits: m.totalCredits, turns: m.turnCount, pct: m.percentage, avgMs: lat.avgMs, tailMs: lat.tailMs, tailLabel: lat.tailLabel };
  });
}

export function buildHeatmapData(dailyCosts: Array<{ period: string; totalCostUsd: number; turnCount: number }>): string {
  const now = new Date();
  const days: Array<{ date: string; cost: number; turns: number }> = [];
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset - 51 * 7);

  const costMap = new Map<string, { cost: number; turns: number }>();
  for (const d of dailyCosts) {
    costMap.set(d.period, { cost: d.totalCostUsd, turns: d.turnCount });
  }

  for (let i = 0; i < 364; i++) {
    const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const key = date.toISOString().slice(0, 10);
    const data = costMap.get(key) || { cost: 0, turns: 0 };
    days.push({ date: key, cost: data.cost, turns: data.turns });
  }

  return JSON.stringify(days);
}

export function getUnknownModelBannerHtml(diagnostics: UnknownModelDiagnostics): string {
  if (diagnostics.excludedTurnCount > 0) {
    const modelList = diagnostics.excludedModels.slice(0, 5).join(", ");
    const moreCount = Math.max(0, diagnostics.excludedModels.length - 5);
    const moreText = moreCount > 0 ? ` (+${moreCount} more)` : "";
    return `
      <div style="margin:10px 16px 0 16px;padding:10px 12px;border:1px solid var(--vscode-editorWarning-foreground, #cca700);border-left:3px solid var(--vscode-editorWarning-foreground, #cca700);border-radius:4px;background:var(--vscode-editorWidget-background);font-size:12px;line-height:1.45">
        <strong>Unknown models excluded from totals</strong>: ${diagnostics.excludedTurnCount} turns across ${diagnostics.excludedModelCount} model(s) were excluded because <code>copilotCostTracker.excludeUnknownModelsFromTotals</code> is enabled.${modelList ? ` Missing models: ${modelList}${moreText}.` : ""}
      </div>`;
  }

  if (diagnostics.fallbackModelCount > 0) {
    const modelList = diagnostics.fallbackModels.slice(0, 5).join(", ");
    const moreCount = Math.max(0, diagnostics.fallbackModels.length - 5);
    const moreText = moreCount > 0 ? ` (+${moreCount} more)` : "";
    return `
      <div style="margin:10px 16px 0 16px;padding:10px 12px;border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:4px;background:var(--vscode-editorWidget-background);font-size:12px;line-height:1.45;color:var(--muted)">
        Unknown model pricing fallback is active for ${diagnostics.fallbackModelCount} model(s). Add <code>copilotCostTracker.customModelRates</code> for more accurate totals.${modelList ? ` Models: ${modelList}${moreText}.` : ""}
      </div>`;
  }

  return "";
}

export function getBudgetColor(percentage: number): string {
  if (percentage > 90) return "var(--vscode-errorForeground)";
  if (percentage > 75) return "var(--vscode-editorWarning-foreground)";
  return "var(--accent)";
}

export function getForecastHtml(
  forecastVisible: boolean,
  projectedCredits: number,
  burnRate: number,
  overage: number,
): string {
  if (!forecastVisible) {
    return `
      <div class="stat-value">-</div>
      <div class="stat-sub">Forecast beschikbaar zodra er meer verbruiksdata is</div>
      <div class="stat-sub">(>= 50 turns of >= 0.50 credits)</div>`;
  }

  const overageHtml = overage > 0
    ? `<div class="stat-sub" style="color:var(--vscode-errorForeground)">+${overage.toFixed(1)} cr boven budget</div>`
    : `<div class="stat-sub">${Math.abs(overage).toFixed(1)} cr onder budget</div>`;

  return `
    <div class="stat-value">${projectedCredits.toFixed(1)} cr</div>
    <div class="stat-sub">Burn rate: ${burnRate.toFixed(2)} cr/day</div>
    ${overageHtml}`;
}

export const AGENT_LABEL_MAP: Record<string, string> = {
  "GitHub Copilot Chat": "Sidebar Chat",
  "panel/editAgent": "Inline Chat",
  "XtabProvider": "Next Edit Suggestions",
  "summarizeConversationHistory": "Context Summarization",
  "progressMessages": "Background Processing",
  "title": "Title Generation",
};
