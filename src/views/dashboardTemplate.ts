import { DASHBOARD_CSS } from "./dashboardCss";
import { createNonce, AGENT_LABEL_MAP } from "./helpers";
import { PricingEngine } from "../pricing";
import type { CostDatabase } from "../database";
import type { DashboardRawData } from "./dashboardDataAssembler";
import {
  buildModelPeriodData, buildHeatmapData, getUsagePresentation, getBudgetDetails,
  buildInsightViewData, buildSurfaceCostView, buildCacheSavingsView,
  buildWorkspaceSummaryView, buildRecentSessionRowsHtml, formatFreshnessLabel,
  buildEstimateData, getInsightStyles, getMeaningfulSurfaces, buildAlertCardsHtml,
  getUnknownModelBannerHtml,
} from "./helpers";
import {
  renderDashboardHeader, renderOverviewTab, renderBudgetTab, renderSessionsTab,
  renderModelsTab, renderTokensTab, renderInsightsTab, renderEstimatesTab,
  renderDashboardScript,
} from "./tabs";
import type { DashboardViewData } from "./tabs";

export interface DashboardTemplateData {
  rawData: DashboardRawData;
  database: CostDatabase;
  pricing: PricingEngine;
  cspSource: string;
  budgetCredits: number;
}

export function renderDashboard(data: DashboardTemplateData): string {
  const { rawData, database, pricing, cspSource, budgetCredits } = data;
  const nonce = createNonce();

  const {
    insightMetrics, alerts, playbook, surfaceData, turnDiscovery, cacheSavings,
    monthTotal, dailyCosts, dailyCostsForRange, insightMetricsFullRange,
    modelBreakdown, agentBreakdown, dailyAgentBreakdown, allSessions,
    billingPeriodStartMs, billingPeriodEndMs, periodCredits, periodAggregate,
  } = rawData;

  const sessionCount = allSessions.length;
  const agentBreakdownSliced = agentBreakdown.slice(0, 12);

  const modelDataByPeriod = {
    "1d": buildModelPeriodData(database, 1),
    "7d": buildModelPeriodData(database, 7),
    "30d": buildModelPeriodData(database, 30),
    "90d": buildModelPeriodData(database, 90),
  };

  const allLatencySamples = database.getModelLatencySamples(30);
  const avgResponseMs = allLatencySamples.length > 0
    ? Math.round(allLatencySamples.reduce((s, x) => s + x.duration, 0) / allLatencySamples.length)
    : 0;
  const avgResponseLabel = avgResponseMs >= 1000 ? (avgResponseMs / 1000).toFixed(1) + "s" : avgResponseMs + "ms";

  const unknownModelDiagnostics = pricing.getUnknownModelDiagnostics();
  const unknownModelBannerHtml = getUnknownModelBannerHtml(unknownModelDiagnostics);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset).getTime();
  const today = database.getCostSince(todayStart);
  const week = database.getCostSince(weekStart);

  const dailyLabels = JSON.stringify(dailyCosts.map((d) => d.period).reverse());
  const dailyData = JSON.stringify(dailyCosts.map((d) => d.totalCostUsd).reverse());
  const dailyCreditsData = JSON.stringify(dailyCosts.map((d) => d.totalCredits).reverse());

  const modelLabels = JSON.stringify(modelBreakdown.map((m) => m.model));
  const modelCostData = JSON.stringify(modelBreakdown.map((m) => m.totalCostUsd));
  const modelTurnData = JSON.stringify(modelBreakdown.map((m) => m.turnCount));
  const modelPctData = JSON.stringify(modelBreakdown.map((m) => m.percentage));
  const agentBreakdownData = JSON.stringify(agentBreakdownSliced);
  const dailyAgentBreakdownData = JSON.stringify(dailyAgentBreakdown);

  const usage = getUsagePresentation(periodCredits, budgetCredits);
  const usagePct = usage.usagePct;

  const budgetDetails = getBudgetDetails(billingPeriodStartMs, billingPeriodEndMs, periodAggregate.turns, periodCredits, budgetCredits);
  const { daysRemaining, dailyBudgetRemaining, burnRate, projectedPeriodCredits, forecastVisible, forecastOverage } = budgetDetails;

  const heatmapData = buildHeatmapData(dailyCostsForRange);
  const dailyRangeSeriesJson = JSON.stringify(dailyCostsForRange.map((d) => ({
    period: d.period, cost: d.totalCostUsd, credits: d.totalCredits, turns: d.turnCount,
  })));

  const insightView = buildInsightViewData(insightMetrics);
  const totalBillableInput30d = insightView.totalBillableInput30d;
  const avgInputPerTurn = insightView.avgInputPerTurn;
  const ioRatioLabels = JSON.stringify(insightMetricsFullRange.ioRatioDays.map((d) => d.period));
  const ioNetInput = JSON.stringify(insightMetricsFullRange.ioRatioDays.map((d) => d.inputTokens));
  const ioCached = JSON.stringify(insightMetricsFullRange.ioRatioDays.map((d) => d.cachedTokens));
  const ioOutput = JSON.stringify(insightMetricsFullRange.ioRatioDays.map((d) => d.outputTokens));

  const meaningfulSurfaces = getMeaningfulSurfaces(surfaceData);
  const surfaceLabels = JSON.stringify(meaningfulSurfaces.map((s) => s.label));
  const surfaceInputs = JSON.stringify(meaningfulSurfaces.map((s) => s.inputTokens + s.cachedTokens));

  const surfaceCostView = buildSurfaceCostView(agentBreakdown, AGENT_LABEL_MAP);
  const surfaceCostLabels = JSON.stringify(surfaceCostView.map((s) => s.label));
  const surfaceCostData = JSON.stringify(surfaceCostView.map((s) => s.costUsd));
  const surfaceCostTableHtml = surfaceCostView
    .map((s) =>
      `<tr>
        <td>${s.label}</td>
        <td class="num">${s.pct.toFixed(1)}%</td>
        <td class="num">$${s.costUsd.toFixed(3)}</td>
        <td class="num">${s.credits.toFixed(1)} cr</td>
        <td class="num" style="color:var(--muted)">${s.turnCount}</td>
      </tr>`)
    .join("");

  const estimateData = buildEstimateData(insightMetrics, monthTotal.costUsd);
  const { estHoursSaved, costPerOutputK, outputTokensK, inputOverheadPct } = estimateData;

  const insightStyles = getInsightStyles(insightMetrics, totalBillableInput30d, avgInputPerTurn);
  const { cacheHitColor, avgInputStyle, avgInputNote, errorStyle, errorNote, ioRatioLabel } = insightStyles;

  const alertCardsHtml = buildAlertCardsHtml(alerts);

  const cacheSavingsView = buildCacheSavingsView(cacheSavings, periodAggregate.costUsd, pricing);

  const workspaceSummaryView = buildWorkspaceSummaryView(allSessions);
  const recentSessionRowsHtml = buildRecentSessionRowsHtml(allSessions);
  const freshnessLabel = formatFreshnessLabel(workspaceSummaryView.lastUpdatedMs);

  const playbookRowsHtml = playbook
    .map((r) =>
      `<tr>
        <td><strong>${r.strategy}</strong></td>
        <td>${r.statusEmoji} ${r.statusLabel}</td>
        <td style="color:var(--muted)">${r.metricDesc}</td>
        <td style="color:var(--muted)">${r.impact}</td>
      </tr>`)
    .join("\n");

  const sessionsJson = JSON.stringify(allSessions.map((s) => ({
    ts: s.startTimestamp,
    sessionId: s.sessionId,
    workspace: s.workspace,
    model: s.primaryModel,
    turns: s.turnCount,
    costUsd: s.totalCostUsd,
    credits: s.totalCredits,
    inputTokens: s.totalInputTokens,
    outputTokens: s.totalOutputTokens,
    cachedTokens: s.totalCachedTokens,
    totalTokens: s.totalInputTokens + s.totalOutputTokens + s.totalCachedTokens,
    avgLatencyMs: Math.round(s.avgDurationMs),
    modelBreakdown: s.modelBreakdown,
  })));
  const turnDiscoveryJson = JSON.stringify(turnDiscovery.slice(0, 400));

  const agentLabelMapJson = JSON.stringify(AGENT_LABEL_MAP);

  const viewData: DashboardViewData = {
    ...rawData,
    sessionCount, today, week, usagePct,
    daysRemaining, dailyBudgetRemaining, burnRate, projectedPeriodCredits, forecastVisible, forecastOverage,
    avgResponseLabel, totalBillableInput30d, avgInputPerTurn,
    cacheHitColor, avgInputStyle, avgInputNote, errorStyle, errorNote, ioRatioLabel,
    alertCardsHtml, playbookRowsHtml, surfaceCostTableHtml,
    estHoursSaved, costPerOutputK, outputTokensK, inputOverheadPct,
    workspaceSummaryView, recentSessionRowsHtml, freshnessLabel,
    unknownModelBannerHtml, cacheSavingsView, surfaceCostView,
    dailyLabels, dailyData, dailyCreditsData,
    modelLabels, modelCostData, modelTurnData, modelPctData,
    agentBreakdownData, dailyAgentBreakdownData,
    heatmapData, dailyRangeSeriesJson, sessionsJson, turnDiscoveryJson, agentLabelMapJson,
    ioRatioLabels, ioNetInput, ioCached, ioOutput,
    surfaceLabels, surfaceInputs, surfaceCostLabels, surfaceCostData,
    modelDataByPeriodJson: JSON.stringify(modelDataByPeriod),
    budgetCredits, billingPeriodStartMs, nonce, cspSource,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; font-src ${cspSource};">
  <title>Copilot Cost Dashboard</title>
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>${DASHBOARD_CSS}</style>
</head>
<body>
  ${renderDashboardHeader(viewData)}
  ${renderOverviewTab(viewData)}
  ${renderBudgetTab(viewData)}
  ${renderSessionsTab(viewData)}
  ${renderModelsTab()}
  ${renderTokensTab()}
  ${renderInsightsTab(viewData)}
  ${renderEstimatesTab(viewData)}
  ${renderDashboardScript(viewData)}
</body>
</html>`;
}
