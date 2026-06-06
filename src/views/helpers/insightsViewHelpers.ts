import { CacheSavingsMetrics, InsightMetrics } from "../../database";
import { PricingEngine } from "../../pricing";
import type { SurfaceBreakdown } from "../../parser";
import type { DashboardAlert } from "../../insights";

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
