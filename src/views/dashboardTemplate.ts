import { DASHBOARD_CSS } from "./dashboardCss";
import { createNonce, AGENT_LABEL_MAP } from "./dashboardHelpers";
import { PricingEngine } from "../pricing";
import type { CostDatabase } from "../database";
import type { DashboardRawData } from "./dashboardDataAssembler";
import {
  buildModelPeriodData, buildHeatmapData, getUsagePresentation, getBudgetDetails,
  buildInsightViewData, buildSurfaceCostView, buildCacheSavingsView,
  buildWorkspaceSummaryView, buildRecentSessionRowsHtml, formatFreshnessLabel,
  buildEstimateData, getInsightStyles, getMeaningfulSurfaces, buildAlertCardsHtml,
  getUnknownModelBannerHtml, getBudgetColor, getForecastHtml,
} from "./dashboardHelpers";

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

  return /*html*/ `<!DOCTYPE html>
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
  <!-- Header -->
  <div class="header">
    <h1>Copilot Cost Tracker</h1>
    <div class="stats">
      <span>Today: <span class="val">$${today.costUsd.toFixed(2)}</span></span>
      <span>Week: <span class="val">$${week.costUsd.toFixed(2)}</span></span>
      <span>Month: <span class="val">$${monthTotal.costUsd.toFixed(2)}</span></span>
      <span>Budget: <span class="val">${usagePct}%</span></span>
      <span>In: <span class="val" id="headerTokenIn">0</span></span>
      <span>Out: <span class="val" id="headerTokenOut">0</span></span>
      <span>Cache: <span class="val" id="headerTokenCache">0%</span></span>
    </div>
  </div>

  <div class="tabs">
    <div class="tab active" data-tab="overview">Overview</div>
    <div class="tab" data-tab="budget">Spending</div>
    <div class="tab" data-tab="sessions">Sessions</div>
    <div class="tab" data-tab="models">Models</div>
    <div class="tab" data-tab="tokens">Tokens</div>
    <div class="tab" data-tab="insights">Insights</div>
    <div class="tab" data-tab="estimates">Estimates ⚠</div>
  </div>

  <div class="global-filter-bar">
    <span class="label">Global Range:</span>
    <button class="preset" data-preset="today">Today</button>
    <button class="preset" data-preset="7d">7d</button>
    <button class="preset" data-preset="30d">30d</button>
    <button class="preset active" data-preset="period">This Period</button>
    <span class="label">From</span>
    <input type="datetime-local" id="globalFrom">
    <span class="label">To</span>
    <input type="datetime-local" id="globalTo">
    <button class="action apply" id="globalApply">Apply</button>
    <button class="action reset" id="globalReset">Reset</button>
    <span id="globalRangeSummary" class="label"></span>
    <span class="freshness-chip" title="Last ingested turn timestamp">Updated: ${freshnessLabel}</span>
  </div>

  ${unknownModelBannerHtml}

  <!-- Overview -->
  <div class="tab-content active" id="tab-overview">
    <div class="stat-row">
      <div class="stat">
        <div class="stat-label" id="overviewRangeCostLabel">Range Cost</div>
        <div class="stat-value" id="overviewRangeCost">$${today.costUsd.toFixed(2)}</div>
        <div class="stat-sub" id="overviewRangeCostSub">${today.credits.toFixed(0)} cr · ${today.turns} turns</div>
      </div>
      <div class="stat">
        <div class="stat-label">Range Credits</div>
        <div class="stat-value" id="overviewRangeCredits">${week.credits.toFixed(0)} cr</div>
        <div class="stat-sub" id="overviewRangeCreditsSub">$${week.costUsd.toFixed(2)} · ${week.turns} turns</div>
      </div>
      <div class="stat">
        <div class="stat-label">Range Turns</div>
        <div class="stat-value" id="overviewRangeTurns">${monthTotal.turns}</div>
        <div class="stat-sub" id="overviewRangeTurnsSub">$${monthTotal.costUsd.toFixed(2)} · ${monthTotal.credits.toFixed(0)} cr</div>
      </div>
      <div class="stat">
        <div class="stat-label">Budget Used (Period)</div>
        <div class="stat-value">${usagePct}%</div>
        <div class="stat-sub">${periodCredits.toFixed(0)} / ${budgetCredits} cr</div>
        <div class="budget-bar"><div class="budget-fill" style="width:${Math.min(100, Number.parseFloat(usagePct))}%"></div></div>
      </div>
      <div class="stat">
        <div class="stat-label">Chat Sessions</div>
        <div class="stat-value" id="overviewSessionCount">${sessionCount}</div>
        <div class="stat-sub" id="overviewSessionCountSub">current range</div>
      </div>
      <div class="stat">
        <div class="stat-label">Top Workspace (Range)</div>
        <div class="stat-value" style="font-size:15px;line-height:1.2">${workspaceSummaryView.topWorkspaceLabel}</div>
        <div class="stat-sub">$${workspaceSummaryView.topWorkspaceCostUsd.toFixed(2)} · ${workspaceSummaryView.topWorkspaceSessions} sessions</div>
      </div>
      <div class="stat">
        <div class="stat-label">LLM Calls</div>
        <div class="stat-value" id="overviewCallCount">${monthTotal.turns}</div>
        <div class="stat-sub" id="overviewCallCountSub">turns in range</div>
      </div>
      <div class="stat">
        <div class="stat-label">Avg Response</div>
        <div class="stat-value">${avgResponseLabel}</div>
        <div class="stat-sub">last 30 days</div>
      </div>
      <div class="stat">
        <div class="stat-label">Cache Savings (Period)</div>
        <div class="stat-value" style="color:${cacheSavingsView.hasSavings ? 'var(--vscode-charts-green, #4caf50)' : 'var(--muted)'}">${cacheSavingsView.hasSavings ? '$' + cacheSavingsView.savingsCostUsd : '—'}</div>
        <div class="stat-sub">${cacheSavingsView.hasSavings ? cacheSavingsView.savingsCredits + ' cr · ' + cacheSavingsView.savingsPct + '% of spend' : 'No cache data this period'}</div>
      </div>
    </div>
    <div class="chart-wrap">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="chart-section-title" id="overviewChartTitle" style="margin-bottom:0">Cost &amp; Credits — Current range</div>
          <button id="helpButton" class="help-button" title="Show definitions for Credits, Tokens, Cost Calculation, Budget, and Billing Period">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 16v-4"></path>
              <path d="M12 8h.01"></path>
            </svg>
          </button>
        </div>
        <div class="period-toggle" id="overviewChartMode">
          <button class="active" data-mode="cost">Cost/Credits</button>
          <button data-mode="tokens">Tokens</button>
        </div>
      </div>
      <canvas id="dailyChart"></canvas>
    </div>

    <!-- Help Modal -->
    <div id="helpModal" class="modal">
      <div class="modal-overlay"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2>Cost Tracking Definitions</h2>
          <button id="closeHelpButton" class="modal-close" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2 14l12-12M14 14L2 2"></path>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="help-section">
            <h3>💳 Credits (CR)</h3>
            <p><strong>1 Credit = $0.01 USD</strong></p>
            <p>Credits represent the monetary cost of using GitHub Copilot. The amount of credits used depends on the number of tokens consumed by your queries and the model you're using.</p>
          </div>
          <div class="help-section">
            <h3>🔤 Tokens</h3>
            <p>Tokens are the units that language models use to process text. Both your input (prompt) and the model's output (response) consume tokens. The number of tokens varies by model and query complexity.</p>
            <p><strong>Token Types:</strong></p>
            <ul>
              <li><strong>Input Tokens:</strong> Tokens from your prompts (questions/requests)</li>
              <li><strong>Output Tokens:</strong> Tokens in the model's responses</li>
              <li><strong>Cached Tokens:</strong> Previously processed tokens that are reused (cheaper than regular input tokens)</li>
              <li><strong>Cache Write Tokens:</strong> Tokens used when writing new data to the cache</li>
            </ul>
          </div>
          <div class="help-section">
            <h3>💰 Cost Calculation</h3>
            <p>Cost is calculated as: <code>(Tokens ÷ 1,000,000) × Price per Million Tokens</code></p>
            <p>Different models have different pricing. For example:</p>
            <ul>
              <li>GPT-5 Mini: $0.25 per 1M input tokens</li>
              <li>Claude Haiku: $1 per 1M input tokens</li>
              <li>Gemini 3.5 Flash: $1.50 per 1M input tokens</li>
            </ul>
          </div>
          <div class="help-section">
            <h3>📊 Budget Tracking</h3>
            <p>Your budget is set in the extension settings and represents your spending limit for the billing period. The dashboard tracks your usage against this budget.</p>
            <ul>
              <li><strong>Budget Used %:</strong> Percentage of your budget consumed</li>
              <li><strong>Days Remaining:</strong> Days left in the current billing period</li>
              <li><strong>Daily Budget:</strong> Average credits you can spend per remaining day</li>
            </ul>
          </div>
          <div class="help-section">
            <h3>⏱️ Billing Period</h3>
            <p>The billing period is determined by your configured billing cycle start day (default: 1st of the month). All costs are grouped by this period for budget tracking and analysis.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Activity heatmap -->
    <div style="margin-top:24px;border-top:1px solid var(--border);padding-top:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div>
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;color:var(--muted)">Activity Heatmap</span>
          <span style="font-size:10px;color:var(--muted);margin-left:8px">Last 12 months</span>
        </div>
        <div id="heatmapToggle" class="heatmap-toggle">
          <button class="active" data-mode="cost">Cost</button>
          <button data-mode="turns">Turns</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <div id="heatmapMonths" style="display:flex;padding-left:30px;margin-bottom:4px;font-size:10px;color:var(--muted)"></div>
        <div style="display:flex;align-items:flex-start">
          <div id="heatmapDayLabels" style="display:flex;flex-direction:column;gap:2px;margin-right:4px;width:26px;flex-shrink:0"></div>
          <div class="heatmap" id="heatmapGrid"></div>
        </div>
      </div>
      <div class="heatmap-legend" style="margin-top:10px">
        <span>None</span>
        <div class="cell" style="background:var(--border)"></div>
        <div class="cell" style="background:#0e4429"></div>
        <div class="cell" style="background:#006d32"></div>
        <div class="cell" style="background:#26a641"></div>
        <div class="cell" style="background:#39d353"></div>
        <span>High</span>
        <span style="margin-left:12px;font-size:10px;color:var(--muted)">Colors scale to your busiest day in this window — hover any cell for the exact value.</span>
      </div>
    </div>
  </div>

  <!-- Budget -->
  <div class="tab-content" id="tab-budget">
    <div class="stat-row">
      <div class="stat">
        <div class="stat-label" id="budgetUsedLabel">Range Used</div>
        <div class="stat-value" id="budgetUsageValue">${usagePct}%</div>
        <div class="stat-sub" id="budgetUsageSub">${periodCredits.toFixed(0)} / ${budgetCredits} cr</div>
        <div class="budget-bar"><div class="budget-fill" id="budgetUsageFill" style="width:${Math.min(100, Number.parseFloat(usagePct))}%;background:${getBudgetColor(Number.parseFloat(usagePct))}"></div></div>
      </div>
      <div class="stat">
        <div class="stat-label">Days Remaining</div>
        <div class="stat-value">${daysRemaining}</div>
        <div class="stat-sub">~${dailyBudgetRemaining} cr/day budget</div>
      </div>
      <div class="stat">
        <div class="stat-label" id="budgetRemainingLabel">Remaining Credits</div>
        <div class="stat-value" id="budgetRemainingValue">${(budgetCredits - periodCredits).toFixed(0)}</div>
        <div class="stat-sub" id="budgetRemainingSub">of ${budgetCredits} total</div>
      </div>
      <div class="stat">
        <div class="stat-label">Forecast (Period End)</div>
        ${getForecastHtml(forecastVisible, projectedPeriodCredits, burnRate, forecastOverage)}
      </div>
      <div class="stat">
        <div class="stat-label">Token Density (Range)</div>
        <div class="stat-value" id="budgetTokenDensity">0</div>
        <div class="stat-sub" id="budgetTokenDensitySub">tokens per credit</div>
      </div>
    </div>
    <h3 style="margin:12px 0 8px;font-size:12px;text-transform:uppercase;color:var(--muted)" id="budgetModelTitle">Model Breakdown (Current Range)</h3>
    <table>
      <thead><tr><th>Model</th><th class="num">Turns</th><th class="num">Credits</th><th class="num">%</th></tr></thead>
      <tbody id="budgetModelsBody"></tbody>
    </table>
  </div>

  <!-- Sessions -->
  <div class="tab-content" id="tab-sessions">
    <div class="session-subtabs">
      <button class="session-subtab active" data-sessions-pane="summary">Summary</button>
      <button class="session-subtab" data-sessions-pane="table">Table</button>
      <button class="session-subtab" data-sessions-pane="discovery">Discovery</button>
    </div>
    <div class="session-pane active" id="sessions-pane-summary">
      <div class="session-zone">
        <div class="section-header">
          <div class="section-title">Session Operations</div>
          <div class="section-sub" id="sessionCount"></div>
        </div>
        <div class="session-focus-grid">
          <div class="insight-panel" style="margin-top:0">
            <h4>Workspace Focus (Current Range)</h4>
            <div class="insight-note">Hier zie je welke workspaces nu het meeste kosten, zodat je optimalisaties gericht kunt plannen.</div>
            <table style="font-size:12px">
              <thead><tr><th>Workspace</th><th class="num">Cost</th><th class="num">Credits</th><th class="num">Sessions</th><th class="num">LLM Calls</th></tr></thead>
              <tbody>${workspaceSummaryView.workspaceRowsHtml}</tbody>
            </table>
          </div>
          <div class="insight-panel" style="margin-top:0">
            <h4>Recent Session Snapshots</h4>
            <div class="insight-note">Snelle session snapshots met model, volume, cache-efficiency en kosten in een compact overzicht.</div>
            <table style="font-size:12px">
              <thead><tr><th>Last Active</th><th>Workspace</th><th>Session</th><th>Primary Model</th><th class="num">LLM Calls</th><th class="num">Cache Hit</th><th class="num">Cost</th></tr></thead>
              <tbody>${recentSessionRowsHtml}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    <div class="session-pane" id="sessions-pane-table">
      <div class="session-zone">
        <div class="section-header">
          <div class="section-title">Session Table</div>
          <div class="section-sub">Diepgaande details per sessie met uitklapbare model-breakdown</div>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:28px"></th>
              <th class="sortable" data-sort="ts">Date</th>
              <th class="sortable" data-sort="model">Model</th>
              <th class="num sortable" data-sort="turns">Turns</th>
              <th class="num sortable" data-sort="costUsd">Cost</th>
              <th class="num sortable" data-sort="credits">Credits</th>
              <th class="num sortable" data-sort="totalTokens">Tokens</th>
              <th class="num sortable" data-sort="cachePct">Cache%</th>
              <th class="num sortable" data-sort="avgLatencyMs">Avg Latency (ms)</th>
            </tr>
            <tr class="table-filter-row">
              <th></th>
              <th><input id="sessionsFilterDate" placeholder="Filter date"></th>
              <th><input id="sessionsFilterModel" placeholder="Filter model"></th>
              <th><input id="sessionsFilterTurns" placeholder="Filter turns"></th>
              <th><input id="sessionsFilterCost" placeholder="Filter cost"></th>
              <th><input id="sessionsFilterCredits" placeholder="Filter credits"></th>
              <th><input id="sessionsFilterTokens" placeholder="Filter tokens"></th>
              <th><input id="sessionsFilterCachePct" placeholder="Filter cache%"></th>
              <th><input id="sessionsFilterLatency" placeholder="Filter latency"></th>
            </tr>
          </thead>
          <tbody id="sessionsBody"></tbody>
        </table>
      </div>
    </div>
    <div class="session-pane" id="sessions-pane-discovery">
      <div class="session-zone" style="margin-bottom:0">
        <div class="section-header">
          <div class="section-title">Turn Discovery</div>
          <div class="section-sub">Inspecteer per turn LLM/tool-calls en anomalies, direct gekoppeld aan sessions</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <button id="discoveryExpandAll" style="font-size:11px;border:1px solid var(--border);border-radius:4px;padding:3px 8px;background:var(--card-bg);color:var(--fg);cursor:pointer">Expand all</button>
          <button id="discoveryCollapseAll" style="font-size:11px;border:1px solid var(--border);border-radius:4px;padding:3px 8px;background:var(--card-bg);color:var(--fg);cursor:pointer">Collapse all</button>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)">
            <input id="discoveryOnlyTools" type="checkbox"> Only rows with tools
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)">
            <input id="discoveryOnlyAnomalies" type="checkbox"> Only anomalies
          </label>
        </div>
        <table style="font-size:12px">
          <thead><tr><th></th><th class="sortable" data-sort="turnIndex">Turn</th><th>Session</th><th class="num sortable" data-sort="llmCalls">LLM</th><th class="num sortable" data-sort="toolCalls">Tools</th><th class="num sortable" data-sort="inputTotal">Input</th><th class="num sortable" data-sort="outputTokens">Output</th><th class="num sortable" data-sort="cacheHitPct">Cache%</th></tr></thead>
          <tbody id="discoveryBody"></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Models -->
  <div class="tab-content" id="tab-models">
    <div class="chart-grid">
      <div class="chart-wrap"><canvas id="modelBarChart"></canvas></div>
      <div class="chart-wrap"><canvas id="modelPieChart"></canvas></div>
    </div>
    <table>
      <thead>
        <tr>
          <th class="sortable" data-sort="model">Model</th>
          <th class="num sortable" data-sort="turns">Turns</th>
          <th class="num sortable" data-sort="cost">Cost (USD)</th>
          <th class="num sortable" data-sort="pct">%</th>
          <th class="num sortable" data-sort="totalTokens">Tokens</th>
          <th class="num sortable" data-sort="cachePct">Cache%</th>
          <th class="num sortable" data-sort="avgMs">Avg (ms)</th>
          <th class="num sortable" data-sort="tailMs">Tail (ms)</th>
        </tr>
        <tr class="table-filter-row">
          <th><input id="modelsFilterModel" placeholder="Filter model"></th>
          <th><input id="modelsFilterTurns" placeholder="Filter turns"></th>
          <th><input id="modelsFilterCost" placeholder="Filter cost"></th>
          <th><input id="modelsFilterPct" placeholder="Filter %"></th>
          <th><input id="modelsFilterTokens" placeholder="Filter tokens"></th>
          <th><input id="modelsFilterCachePct" placeholder="Filter cache%"></th>
          <th><input id="modelsFilterAvg" placeholder="Filter avg"></th>
          <th><input id="modelsFilterTail" placeholder="Filter tail"></th>
        </tr>
      </thead>
      <tbody id="modelsBody"></tbody>
    </table>
    <h3 id="modelsAgentsTitle" style="margin:16px 0 8px;font-size:12px;text-transform:uppercase;color:var(--muted)">Agents (Current Range, by Cost)</h3>
    <table>
      <thead><tr><th>Agent</th><th class="num">Turns</th><th class="num">Credits</th><th class="num">Cost (USD)</th><th class="num">%</th></tr></thead>
      <tbody id="modelsAgentsBody"></tbody>
    </table>
  </div>

  <!-- Tokens -->
  <div class="tab-content" id="tab-tokens">
    <div class="stat-row">
      <div class="stat">
        <div class="stat-label">Total Input Tokens (Range)</div>
        <div class="stat-value" id="tokensTotalInput">0</div>
        <div class="stat-sub" id="tokensTotalInputSub">net + cached input</div>
      </div>
      <div class="stat">
        <div class="stat-label">Cached Input Tokens (Range)</div>
        <div class="stat-value" id="tokensTotalCached">0</div>
        <div class="stat-sub" id="tokensTotalCachedSub">cache hit 0.0%</div>
      </div>
      <div class="stat">
        <div class="stat-label">Output Tokens (Range)</div>
        <div class="stat-value" id="tokensTotalOutput">0</div>
        <div class="stat-sub" id="tokensTotalOutputSub">I:O ratio —:1</div>
      </div>
      <div class="stat">
        <div class="stat-label">Avg Tokens / Turn (Range)</div>
        <div class="stat-value" id="tokensAvgPerTurn">0</div>
        <div class="stat-sub" id="tokensAvgPerTurnSub">0 turns in range</div>
      </div>
      <div class="stat">
        <div class="stat-label">Top Cost Model (Range)</div>
        <div class="stat-value" id="tokensTopModel">N/A</div>
        <div class="stat-sub" id="tokensTopModelSub">$0.00 (0.0%)</div>
      </div>
    </div>
    <h3 style="margin:12px 0 8px;font-size:13px;">Cost per Model per Turn</h3>
    <table>
      <thead>
        <tr>
          <th class="sortable" data-sort="model">Model</th>
          <th class="num sortable" data-sort="turns">Turns</th>
          <th class="num sortable" data-sort="totalCost">Total Cost</th>
          <th class="num sortable" data-sort="avgCost">Avg/Turn</th>
          <th class="num sortable" data-sort="avgCredits">Credits/Turn</th>
        </tr>
        <tr class="table-filter-row">
          <th><input id="tokensFilterModel" placeholder="Filter model"></th>
          <th><input id="tokensFilterTurns" placeholder="Filter turns"></th>
          <th><input id="tokensFilterCost" placeholder="Filter cost"></th>
          <th><input id="tokensFilterAvgCost" placeholder="Filter avg/turn"></th>
          <th><input id="tokensFilterAvgCredits" placeholder="Filter cr/turn"></th>
        </tr>
      </thead>
      <tbody id="tokensBody"></tbody>
    </table>
  </div>

  <!-- Insights -->
  <div class="tab-content" id="tab-insights">
    <div class="chart-section-title" style="margin-bottom:8px">Token Savings Playbook — Today</div>
    <div style="margin-bottom:16px">${alertCardsHtml}</div>
    <table style="margin-bottom:20px">
      <thead><tr><th>Strategy</th><th>Status</th><th>Your Metric</th><th>Impact</th></tr></thead>
      <tbody>${playbookRowsHtml}</tbody>
    </table>
    <div id="insightsRangeAlerts" style="margin:0 0 16px 0"></div>
    <div style="border-top:1px solid var(--border);padding-top:16px">
      <div class="stat-row">
        <div class="stat">
          <div class="stat-label">Cache Hit Rate (Range)</div>
          <div class="stat-value" id="insightCacheHitValue" style="color:${cacheHitColor}">${insightMetrics.cacheHitPct.toFixed(1)}%</div>
          <div class="stat-sub" id="insightCacheHitSub">${(insightMetrics.totalCachedTokens / 1000).toFixed(0)}K cached of ${((insightMetrics.totalInputTokens + insightMetrics.totalCachedTokens) / 1000).toFixed(0)}K total input · ${insightMetrics.cacheHitPct >= 70 ? 'Excellent' : insightMetrics.cacheHitPct >= 40 ? 'Moderate — reuse files across sessions' : 'Low — avoid large one-off pastes'}</div>
          <div class="budget-bar"><div class="budget-fill" id="insightCacheHitFill" style="width:${Math.min(100, insightMetrics.cacheHitPct)}%;background:${cacheHitColor}"></div></div>
        </div>
        <div class="stat">
          <div class="stat-label">Input:Output Ratio (Range)</div>
          <div class="stat-value" id="insightIoRatioValue">${ioRatioLabel}</div>
          <div class="stat-sub" id="insightIoRatioSub">${(totalBillableInput30d / 1000).toFixed(0)}K in · ${(insightMetrics.totalOutputTokens / 1000).toFixed(0)}K out</div>
        </div>
        <div class="stat">
          <div class="stat-label">Avg Input / Turn (Range)</div>
          <div class="stat-value" id="insightAvgInputValue" style="${avgInputStyle}">${avgInputPerTurn}K</div>
          <div class="stat-sub" id="insightAvgInputSub">${avgInputNote}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Error Turns (30d)</div>
          <div class="stat-value" style="${errorStyle}">${insightMetrics.errorTurns}</div>
          <div class="stat-sub">${errorNote}</div>
        </div>
      </div>
      <div class="chart-grid">
        <div>
          <div class="chart-section-title" id="insightTokenFlowTitle">Token Flow — Current range (stacked)</div>
          <div class="chart-wrap"><canvas id="tokenTrendChart"></canvas></div>
        </div>
        <div>
          <div class="chart-section-title">Spend by Action Type (30d)</div>
          <div class="chart-wrap" style="display:flex;align-items:center;justify-content:center">
            ${surfaceCostView.length > 0 ? '<canvas id="surfaceCostPieChart"></canvas>' : '<span style="color:var(--muted);font-size:12px">No data yet</span>'}
          </div>
        </div>
      </div>
      ${surfaceCostView.length > 0 ? `
      <div style="margin-top:4px">
        <div class="chart-section-title" style="margin-bottom:6px">Action Type Breakdown (30d)</div>
        <table style="font-size:12px">
          <thead><tr><th>Surface</th><th class="num">%</th><th class="num">Cost</th><th class="num">Credits</th><th class="num" style="color:var(--muted)">Turns</th></tr></thead>
          <tbody>${surfaceCostTableHtml}</tbody>
        </table>
      </div>` : ''}
      ${cacheSavingsView.hasSavings ? `
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:8px">
          <div class="chart-section-title" style="margin-bottom:0">Cache Savings (Period)</div>
          <span style="font-size:18px;font-weight:700;color:var(--vscode-charts-green,#4caf50)">$${cacheSavingsView.savingsCostUsd}</span>
          <span style="font-size:11px;color:var(--muted)">${cacheSavingsView.savingsCredits} cr · ${cacheSavingsView.savingsPct}% of period spend</span>
        </div>
        <table style="font-size:12px">
          <thead><tr><th>Model</th><th class="num">%</th><th class="num" style="color:var(--vscode-charts-green,#4caf50)">Saved</th></tr></thead>
          <tbody>${cacheSavingsView.topModelRows}</tbody>
        </table>
      </div>` : ''}
    </div>
  </div>

  <!-- Estimates -->
  <div class="tab-content" id="tab-estimates">
    <div style="background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-editorWarning-foreground, #cca700);border-radius:4px;padding:10px 14px;margin-bottom:16px;font-size:12px;line-height:1.5">
      <strong>⚠ Speculative Estimates</strong> — These numbers are approximations based on token counts and industry-average typing speed (175 chars/min coding baseline, ~30% over raw typing to account for thinking time). Copilot does not expose acceptance rate, keystroke counts, or retained-LOC data to third-party extensions. Use these to spot trends, not for billing or performance reviews.
    </div>
    <div class="stat-row">
      <div class="stat">
        <div class="stat-label">Est. Time Saved (30d)</div>
        <div class="stat-value">${estHoursSaved}h</div>
        <div class="stat-sub">output chars ÷ 175 CPM, capped at 2 min/turn</div>
      </div>
      <div class="stat">
        <div class="stat-label">Cost per Output-K Tokens</div>
        <div class="stat-value">$${costPerOutputK}</div>
        <div class="stat-sub">USD per 1,000 output tokens (30d)</div>
      </div>
      <div class="stat">
        <div class="stat-label">Output Tokens (30d)</div>
        <div class="stat-value">${outputTokensK}K</div>
        <div class="stat-sub">generated text across all models</div>
      </div>
      <div class="stat">
        <div class="stat-label">Input Overhead</div>
        <div class="stat-value">${inputOverheadPct}%</div>
        <div class="stat-sub">of all tokens are context, not generation</div>
      </div>
    </div>
    <h3 style="margin:20px 0 8px;font-size:12px;font-weight:600;text-transform:uppercase;color:var(--muted)">Formula Reference</h3>
    <table>
      <thead><tr><th>Metric</th><th>Formula</th><th>Assumption</th><th>Known Limitation</th></tr></thead>
      <tbody>
        <tr><td>Time Saved</td><td><code>min(output_chars ÷ 175 CPM, turns × 2 min)</code></td><td>1 token ≈ 4 chars; developer codes at 175 chars/min</td><td>No acceptance rate — assumes 100% of output is used</td></tr>
        <tr><td>Cost per Output-K</td><td><code>monthly_cost ÷ (output_tokens ÷ 1000)</code></td><td>Linear cost-per-token relationship</td><td>Cached tokens reduce cost but are excluded from denominator</td></tr>
        <tr><td>Input Overhead</td><td><code>(input + cached) ÷ (input + cached + output)</code></td><td>All token categories reported by the API</td><td>High values (&gt;90%) are normal for agent workflows with large context</td></tr>
      </tbody>
    </table>
    <div style="margin-top:16px;padding:10px 14px;background:var(--vscode-editorWidget-background);border-radius:4px;font-size:11px;color:var(--muted)">
      <strong>What is not tracked:</strong> Acceptance rate (ghost text Tab/Esc), retained lines of code after editing, copy/insert events from chat panel, and per-request HTTP error codes. These require hooks into Copilot internals that are not exposed to third-party extensions.
    </div>
  </div>

  <script nonce="${nonce}">
    const AGENT_LABEL_MAP = ${agentLabelMapJson};

    function normalizeAgentName(agentName) {
      if (!agentName || agentName === 'unknown') return 'Unknown';
      return AGENT_LABEL_MAP[agentName] || agentName;
    }

    function switchToTab(tabName) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      const tab = document.querySelector('.tab[data-tab="' + tabName + '"]');
      if (tab) tab.classList.add('active');
      const content = document.getElementById('tab-' + tabName);
      if (content) content.classList.add('active');
    }

    function switchSessionPane(paneName) {
      document.querySelectorAll('.session-subtab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sessionsPane === paneName);
      });
      document.querySelectorAll('.session-pane').forEach(p => p.classList.remove('active'));
      const pane = document.getElementById('sessions-pane-' + paneName);
      if (pane) pane.classList.add('active');
    }

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => { switchToTab(tab.dataset.tab); });
    });

    document.querySelectorAll('.session-subtab').forEach(btn => {
      btn.addEventListener('click', () => { switchSessionPane(btn.dataset.sessionsPane || 'summary'); });
    });

    // Help modal
    const helpButton = document.getElementById('helpButton');
    const helpModal = document.getElementById('helpModal');
    const closeHelpButton = document.getElementById('closeHelpButton');
    const modalOverlay = helpModal.querySelector('.modal-overlay');

    if (helpButton) helpButton.addEventListener('click', () => helpModal.classList.add('show'));
    if (closeHelpButton) closeHelpButton.addEventListener('click', () => helpModal.classList.remove('show'));
    if (modalOverlay) modalOverlay.addEventListener('click', () => helpModal.classList.remove('show'));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && helpModal.classList.contains('show')) helpModal.classList.remove('show');
    });

    const textColor = getComputedStyle(document.body).getPropertyValue('color') || '#ccc';
    const gridColor = 'rgba(128,128,128,0.15)';
    const budgetCredits = ${budgetCredits};
    const billingPeriodStartMs = ${billingPeriodStartMs};

    function appendCell(tr, value, className, title) {
      const td = document.createElement('td');
      if (className) td.className = className;
      td.textContent = String(value ?? '');
      if (title) td.title = String(title);
      tr.appendChild(td);
    }

    const dailyRangeSeries = ${dailyRangeSeriesJson};

    const dailyChartInst = new Chart(document.getElementById('dailyChart'), {
      type: 'line',
      data: {
        labels: ${dailyLabels},
        datasets: [{
          label: 'Cost (USD)', data: ${dailyData}, borderColor: '#4fc3f7',
          backgroundColor: 'rgba(79,195,247,0.08)', fill: true, tension: 0.3, pointRadius: 2,
        }, {
          label: 'Credits', data: ${dailyCreditsData}, borderColor: '#81c784',
          fill: false, tension: 0.3, pointRadius: 2, yAxisID: 'y2',
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { color: textColor, maxTicksLimit: 8, font: { size: 10 } }, grid: { color: gridColor } },
          y: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor }, title: { display: true, text: 'USD', color: textColor, font: { size: 10 } } },
          y2: { position: 'right', ticks: { color: textColor, font: { size: 10 } }, grid: { display: false }, title: { display: true, text: 'Credits', color: textColor, font: { size: 10 } } }
        },
        plugins: { legend: { labels: { color: textColor, font: { size: 11 } } } }
      }
    });

    const modelDataByPeriod = ${JSON.stringify(modelDataByPeriod)};
    const colors = ['#4fc3f7','#81c784','#ffb74d','#e57373','#ba68c8','#4db6ac','#fff176','#90a4ae'];
    const modelLabels = ${modelLabels};
    const modelCostData = ${modelCostData};
    const modelTurnData = ${modelTurnData};
    const modelPctData = ${modelPctData};
    const agentBreakdown30d = ${agentBreakdownData};
    const agentDailyBreakdown = ${dailyAgentBreakdownData};

    const modelBarChartInst = new Chart(document.getElementById('modelBarChart'), {
      type: 'bar',
      data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        scales: {
          x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
          y: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } }
        },
        plugins: { legend: { display: false } }
      }
    });

    const modelPieChartInst = new Chart(document.getElementById('modelPieChart'), {
      type: 'doughnut',
      data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: textColor, font: { size: 10 } }, position: 'right' } }
      }
    });

    const sessions = ${sessionsJson};
    const turnDiscovery = ${turnDiscoveryJson};
    const MAX_SESSION_ROWS = 500;
    const globalFilter = { preset: 'period', fromMs: null, toMs: null };
    const sessionsSort = { key: 'ts', dir: 'desc' };
    const modelsSort = { key: 'cost', dir: 'desc' };
    const tokensSort = { key: 'totalCost', dir: 'desc' };
    const discoverySort = { key: 'lastTimeMs', dir: 'desc' };
    const discoveryState = { onlyTools: false, onlyAnomalies: false, expandAll: false, expandedKeys: new Set() };
    let overviewChartMode = 'cost';

    function getDiscoveryKey(row) { return String(row.chatSessionId || '') + '::' + String(Number(row.turnIndex || 0)); }
    function isDiscoveryAnomaly(row) { return Number(row.cacheHitPct || 0) < 40 || Number(row.toolCalls || 0) > 0; }

    function formatLocalDateTimeInput(ts) {
      const d = new Date(ts);
      const pad = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function formatSessionDate(ts) {
      return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function getPresetRange(preset) {
      const now = Date.now();
      const msDay = 24 * 60 * 60 * 1000;
      if (preset === 'today') { const d = new Date(); const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); return { fromMs: start, toMs: now }; }
      if (preset === '30d') return { fromMs: now - 30 * msDay, toMs: now };
      if (preset === 'period') return { fromMs: billingPeriodStartMs, toMs: now };
      return { fromMs: now - 7 * msDay, toMs: now };
    }

    function applyPreset(preset) {
      const range = getPresetRange(preset);
      globalFilter.preset = preset;
      globalFilter.fromMs = range.fromMs;
      globalFilter.toMs = range.toMs;
      document.getElementById('globalFrom').value = formatLocalDateTimeInput(range.fromMs);
      document.getElementById('globalTo').value = formatLocalDateTimeInput(range.toMs);
      document.querySelectorAll('.global-filter-bar .preset').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === preset);
      });
      rerenderAll();
    }

    function getRangeSummary(fromMs, toMs) {
      return (fromMs ? formatSessionDate(fromMs) : 'any') + ' → ' + (toMs ? formatSessionDate(toMs) : 'now');
    }

    function getFilteredSessionsBase() {
      return sessions.filter(s =>
        (globalFilter.fromMs === null || s.ts >= globalFilter.fromMs) &&
        (globalFilter.toMs === null || s.ts <= globalFilter.toMs)
      );
    }

    function getFilteredDailySeries() {
      return dailyRangeSeries.filter(d => {
        const dayTs = new Date(d.period + 'T00:00:00').getTime();
        const dayEndTs = dayTs + 86400000 - 1;
        return (globalFilter.fromMs === null || dayEndTs >= globalFilter.fromMs)
          && (globalFilter.toMs === null || dayTs <= globalFilter.toMs);
      });
    }

    function compareValues(a, b, dir) {
      if (typeof a === 'string' || typeof b === 'string') { const cmp = String(a).localeCompare(String(b)); return dir === 'asc' ? cmp : -cmp; }
      const diff = Number(a) - Number(b);
      return dir === 'asc' ? diff : -diff;
    }

    function getTextFilter(id) { const el = document.getElementById(id); return (el && el.value ? el.value.trim().toLowerCase() : ''); }
    function includesFilter(value, filter) { return !filter || String(value).toLowerCase().includes(filter); }

    function getModelRowsFromSessions(baseSessions) {
      const grouped = new Map();
      for (const s of baseSessions) {
        const item = grouped.get(s.model) || { model: s.model, turns: 0, cost: 0, credits: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, latencies: [] };
        item.turns += Number(s.turns || 0);
        item.cost += Number(s.costUsd || 0);
        item.credits += Number(s.credits || 0);
        item.inputTokens += Number(s.inputTokens || 0);
        item.outputTokens += Number(s.outputTokens || 0);
        item.cachedTokens += Number(s.cachedTokens || 0);
        item.totalTokens += Number(s.totalTokens || 0);
        if (Number(s.avgLatencyMs) > 0) item.latencies.push(Number(s.avgLatencyMs));
        grouped.set(s.model, item);
      }
      const rows = Array.from(grouped.values());
      const totalCost = rows.reduce((sum, r) => sum + r.cost, 0);
      return rows.map(r => {
        const sorted = r.latencies.slice().sort((a, b) => a - b);
        const avgMs = sorted.length > 0 ? Math.round(sorted.reduce((sum, n) => sum + n, 0) / sorted.length) : 0;
        const tailMs = sorted.length > 0 ? sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)] : 0;
        return {
          model: r.model, turns: r.turns, cost: r.cost, credits: r.credits,
          pct: totalCost > 0 ? (r.cost / totalCost) * 100 : 0,
          inputTokens: r.inputTokens, outputTokens: r.outputTokens, cachedTokens: r.cachedTokens, totalTokens: r.totalTokens,
          cachePct: (r.inputTokens + r.cachedTokens) > 0 ? (r.cachedTokens / (r.inputTokens + r.cachedTokens)) * 100 : 0,
          avgMs, tailMs,
          tailLabel: sorted.length >= 20 ? 'P90' : sorted.length >= 5 ? 'P50' : '-',
        };
      });
    }

    function getRangePresetLabel() {
      if (globalFilter.preset === 'today') return 'Today';
      if (globalFilter.preset === '30d') return 'Last 30 days';
      if (globalFilter.preset === 'period') return 'This period';
      if (globalFilter.preset === '7d') return 'Last 7 days';
      return 'Custom range';
    }

    function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

    function formatCompactNumber(value) {
      if (!Number.isFinite(value)) return '0';
      if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(1) + 'M';
      if (Math.abs(value) >= 1000) return (value / 1000).toFixed(1) + 'K';
      return String(Math.round(value));
    }

    function roundHalfUp(value, decimals) {
      const factor = Math.pow(10, decimals);
      return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
    }

    function updateOverviewAndBudget(baseSessions, modelRows, dailySeries, insightDays) {
      const totalCost = baseSessions.reduce((sum, s) => sum + Number(s.costUsd || 0), 0);
      const totalCredits = baseSessions.reduce((sum, s) => sum + Number(s.credits || 0), 0);
      const totalTurns = baseSessions.reduce((sum, s) => sum + Number(s.turns || 0), 0);
      const totalInput = insightDays.reduce((sum, d) => sum + d.input, 0);
      const totalCached = insightDays.reduce((sum, d) => sum + d.cached, 0);
      const totalOutput = insightDays.reduce((sum, d) => sum + d.output, 0);
      const billableInput = totalInput + totalCached;
      const cacheHitPct = billableInput > 0 ? (totalCached / billableInput) * 100 : 0;
      const totalTokens = billableInput + totalOutput;
      const usagePct = budgetCredits > 0 ? ((totalCredits / budgetCredits) * 100) : 0;
      const usageColor = usagePct >= 100 ? '#e57373' : usagePct >= 80 ? '#ffb74d' : '#81c784';
      const presetLabel = getRangePresetLabel();

      setText('overviewRangeCostLabel', 'Range Cost (' + presetLabel + ')');
      setText('overviewRangeCost', '$' + totalCost.toFixed(2));
      setText('overviewRangeCostSub', totalCredits.toFixed(0) + ' cr · ' + totalTurns + ' turns');
      setText('overviewRangeCredits', totalCredits.toFixed(0) + ' cr');
      setText('overviewRangeCreditsSub', '$' + totalCost.toFixed(2) + ' · ' + totalTurns + ' turns');
      setText('overviewRangeTurns', String(totalTurns));
      setText('overviewRangeTurnsSub', '$' + totalCost.toFixed(2) + ' · ' + totalCredits.toFixed(0) + ' cr');
      setText('overviewSessionCount', String(baseSessions.length));
      setText('overviewSessionCountSub', 'current range');
      setText('overviewCallCount', String(totalTurns));
      setText('overviewCallCountSub', 'turns in range');
      setText('headerTokenIn', formatCompactNumber(billableInput));
      setText('headerTokenOut', formatCompactNumber(totalOutput));
      setText('headerTokenCache', cacheHitPct.toFixed(1) + '%');

      setText('budgetUsedLabel', 'Range Used');
      setText('budgetUsageValue', usagePct.toFixed(1) + '%');
      setText('budgetUsageSub', totalCredits.toFixed(0) + ' / ' + budgetCredits + ' cr');
      setText('budgetRemainingValue', Math.max(0, budgetCredits - totalCredits).toFixed(0));
      setText('budgetRemainingSub', 'of ' + budgetCredits + ' total');
      const tokenDensity = totalCredits > 0 ? (totalTokens / totalCredits) : 0;
      setText('budgetTokenDensity', formatCompactNumber(tokenDensity));
      setText('budgetTokenDensitySub', totalCredits > 0 ? 'tokens per credit in range' : 'no credits in range');
      const fill = document.getElementById('budgetUsageFill');
      if (fill) { fill.style.width = Math.min(100, usagePct).toFixed(1) + '%'; fill.style.background = usageColor; }

      const ordered = dailySeries.slice().sort((a, b) => String(a.period).localeCompare(String(b.period)));
      const labels = ordered.map(d => d.period);
      const costs = ordered.map(d => d.cost);
      const credits = ordered.map(d => d.credits);
      const tokenOrdered = insightDays.slice().sort((a, b) => String(a.period).localeCompare(String(b.period)));
      if (overviewChartMode === 'tokens') {
        dailyChartInst.data.labels = tokenOrdered.map(d => d.period);
        dailyChartInst.data.datasets = [
          { label: 'Cached Input', data: tokenOrdered.map(d => d.cached), borderColor: '#4fc3f7', backgroundColor: 'rgba(79,195,247,0.20)', fill: false, tension: 0.3, pointRadius: 2 },
          { label: 'Net Input', data: tokenOrdered.map(d => d.input), borderColor: '#81c784', backgroundColor: 'rgba(129,199,132,0.20)', fill: false, tension: 0.3, pointRadius: 2 },
          { label: 'Output', data: tokenOrdered.map(d => d.output), borderColor: '#ffb74d', backgroundColor: 'rgba(255,183,77,0.20)', fill: false, tension: 0.3, pointRadius: 2 },
        ];
      } else {
        dailyChartInst.data.labels = labels;
        dailyChartInst.data.datasets = [
          { label: 'Cost (USD)', data: costs, borderColor: '#4fc3f7', backgroundColor: 'rgba(79,195,247,0.08)', fill: true, tension: 0.3, pointRadius: 2 },
          { label: 'Credits', data: credits, borderColor: '#81c784', fill: false, tension: 0.3, pointRadius: 2, yAxisID: 'y2' },
        ];
      }
      dailyChartInst.update();
      setText('overviewChartTitle', (overviewChartMode === 'tokens' ? 'Tokens' : 'Cost & Credits') + ' — ' + presetLabel);
      setText('budgetModelTitle', 'Model Breakdown (' + presetLabel + ')');
    }

    function getFallbackModelRows() {
      return (modelDataByPeriod['7d'] || modelDataByPeriod['30d'] || []).map(r => ({ ...r, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, cachePct: 0 }));
    }

    function renderModels(rows) {
      const labels = rows.map(r => r.model);
      const costs = rows.map(r => r.cost);
      const pcts = rows.map(r => r.pct);
      const clrs = colors.slice(0, Math.max(labels.length, 1));
      modelBarChartInst.data.labels = labels;
      modelBarChartInst.data.datasets[0].data = costs;
      modelBarChartInst.data.datasets[0].backgroundColor = clrs;
      modelBarChartInst.update();
      modelPieChartInst.data.labels = labels;
      modelPieChartInst.data.datasets[0].data = pcts;
      modelPieChartInst.data.datasets[0].backgroundColor = clrs;
      modelPieChartInst.update();
      const body = document.getElementById('modelsBody');
      body.innerHTML = '';
      rows.forEach(r => {
        const tr = document.createElement('tr');
        appendCell(tr, r.model);
        appendCell(tr, r.turns, 'num');
        appendCell(tr, '$' + r.cost.toFixed(3), 'num');
        appendCell(tr, r.pct.toFixed(1) + '%', 'num');
        appendCell(tr, formatCompactNumber(r.totalTokens), 'num');
        appendCell(tr, r.cachePct.toFixed(1) + '%', 'num');
        appendCell(tr, r.avgMs > 0 ? r.avgMs : '-', 'num');
        appendCell(tr, r.tailMs > 0 ? r.tailLabel + ' ' + r.tailMs : '-', 'num');
        body.appendChild(tr);
      });
    }

    function getAgentRowsForRange() {
      const grouped = new Map();
      for (const row of agentDailyBreakdown) {
        const dayTs = new Date(row.period + 'T00:00:00').getTime();
        const dayEndTs = dayTs + 86400000 - 1;
        if ((globalFilter.fromMs !== null && dayEndTs < globalFilter.fromMs) || (globalFilter.toMs !== null && dayTs > globalFilter.toMs)) continue;
        const key = row.agentName || 'unknown';
        const item = grouped.get(key) || { agentName: key, totalCostUsd: 0, totalCredits: 0, turnCount: 0, percentage: 0 };
        item.totalCostUsd += Number(row.totalCostUsd || 0);
        item.totalCredits += Number(row.totalCredits || 0);
        item.turnCount += Number(row.turnCount || 0);
        grouped.set(key, item);
      }
      const rows = Array.from(grouped.values()).sort((a, b) => b.totalCostUsd - a.totalCostUsd).slice(0, 12);
      const totalCost = rows.reduce((sum, r) => sum + r.totalCostUsd, 0);
      rows.forEach(r => { r.percentage = totalCost > 0 ? (r.totalCostUsd / totalCost) * 100 : 0; });
      return rows;
    }

    function renderAgentsForRange() {
      const body = document.getElementById('modelsAgentsBody');
      body.innerHTML = '';
      const rangeRows = getAgentRowsForRange();
      const rows = rangeRows.length > 0 ? rangeRows : agentBreakdown30d;
      rows.forEach(row => {
        const tr = document.createElement('tr');
        appendCell(tr, normalizeAgentName(row.agentName), '', row.agentName || 'unknown');
        appendCell(tr, Number(row.turnCount || 0), 'num');
        appendCell(tr, Number(row.totalCredits || 0).toFixed(1), 'num');
        appendCell(tr, '$' + Number(row.totalCostUsd || 0).toFixed(3), 'num');
        appendCell(tr, Number(row.percentage || 0).toFixed(1) + '%', 'num');
        body.appendChild(tr);
      });
      setText('modelsAgentsTitle', 'Agents (' + getRangePresetLabel() + ', by Cost)');
    }

    const sessionsBody = document.getElementById('sessionsBody');
    const sessionCountEl = document.getElementById('sessionCount');

    function createSessionDetailContent(session) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'padding:10px 12px;background:var(--card-bg);border:1px solid var(--border);border-radius:4px';
      const title = document.createElement('div');
      title.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:0.3px;color:var(--muted);margin-bottom:8px';
      title.textContent = 'Per-model breakdown';
      wrapper.appendChild(title);
      const rows = Array.isArray(session.modelBreakdown) ? session.modelBreakdown : [];
      if (rows.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:12px;color:var(--muted)';
        empty.textContent = 'No per-model breakdown is available for this session.';
        wrapper.appendChild(empty);
        return wrapper;
      }
      const table = document.createElement('table');
      table.style.marginBottom = '0';
      const thead = document.createElement('thead');
      const headTr = document.createElement('tr');
      ['Model', 'Turns', 'Cost', 'Credits', 'Tokens', 'Cache%'].forEach((label, idx) => {
        const th = document.createElement('th');
        th.textContent = label;
        if (idx > 0) th.className = 'num';
        headTr.appendChild(th);
      });
      thead.appendChild(headTr);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      rows.forEach(row => {
        const tr = document.createElement('tr');
        appendCell(tr, row.model);
        appendCell(tr, Number(row.turnCount || 0), 'num');
        appendCell(tr, '$' + Number(row.totalCostUsd || 0).toFixed(3), 'num');
        appendCell(tr, Number(row.totalCredits || 0).toFixed(1), 'num');
        const modelTotalTokens = Number(row.totalInputTokens || 0) + Number(row.totalOutputTokens || 0) + Number(row.totalCachedTokens || 0);
        appendCell(tr, formatCompactNumber(modelTotalTokens), 'num');
        const modelInputPlusCached = Number(row.totalInputTokens || 0) + Number(row.totalCachedTokens || 0);
        const modelCachePct = modelInputPlusCached > 0 ? (Number(row.totalCachedTokens || 0) / modelInputPlusCached) * 100 : 0;
        appendCell(tr, modelCachePct.toFixed(1) + '%', 'num');
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrapper.appendChild(table);
      return wrapper;
    }

    function renderSessions(filteredBase) {
      const filtered = filteredBase.filter(s => {
        const cachePct = (Number(s.inputTokens || 0) + Number(s.cachedTokens || 0)) > 0 ? (Number(s.cachedTokens || 0) / (Number(s.inputTokens || 0) + Number(s.cachedTokens || 0))) * 100 : 0;
        return includesFilter(formatSessionDate(s.ts), getTextFilter('sessionsFilterDate'))
          && includesFilter(s.model, getTextFilter('sessionsFilterModel'))
          && includesFilter(s.turns, getTextFilter('sessionsFilterTurns'))
          && includesFilter(Number(s.costUsd).toFixed(3), getTextFilter('sessionsFilterCost'))
          && includesFilter(Number(s.credits).toFixed(1), getTextFilter('sessionsFilterCredits'))
          && includesFilter(Number(s.totalTokens || 0), getTextFilter('sessionsFilterTokens'))
          && includesFilter(cachePct.toFixed(1), getTextFilter('sessionsFilterCachePct'))
          && includesFilter(s.avgLatencyMs, getTextFilter('sessionsFilterLatency'));
      }).sort((a, b) => compareValues(a[sessionsSort.key], b[sessionsSort.key], sessionsSort.dir));

      const visible = filtered.slice(0, MAX_SESSION_ROWS);
      sessionsBody.innerHTML = '';
      visible.forEach(s => {
        const tr = document.createElement('tr');
        tr.dataset.sessionId = s.sessionId;
        const toggleTd = document.createElement('td');
        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.textContent = '▸';
        toggleButton.title = 'Show per-model details';
        toggleButton.style.cssText = 'width:20px;height:20px;border:1px solid var(--border);background:var(--card-bg);color:var(--fg);border-radius:3px;cursor:pointer';
        toggleTd.appendChild(toggleButton);
        tr.appendChild(toggleTd);
        appendCell(tr, formatSessionDate(s.ts));
        appendCell(tr, s.model);
        appendCell(tr, s.turns, 'num');
        appendCell(tr, '$' + Number(s.costUsd).toFixed(3), 'num');
        appendCell(tr, Number(s.credits).toFixed(1), 'num');
        appendCell(tr, formatCompactNumber(Number(s.totalTokens || 0)), 'num');
        const cachePct = (Number(s.inputTokens || 0) + Number(s.cachedTokens || 0)) > 0 ? (Number(s.cachedTokens || 0) / (Number(s.inputTokens || 0) + Number(s.cachedTokens || 0))) * 100 : 0;
        appendCell(tr, cachePct.toFixed(1) + '%', 'num');
        appendCell(tr, s.avgLatencyMs, 'num');
        const detailTr = document.createElement('tr');
        detailTr.style.display = 'none';
        const detailTd = document.createElement('td');
        detailTd.colSpan = 9;
        detailTd.appendChild(createSessionDetailContent(s));
        detailTr.appendChild(detailTd);
        toggleButton.addEventListener('click', () => {
          const isClosed = detailTr.style.display === 'none';
          detailTr.style.display = isClosed ? '' : 'none';
          toggleButton.textContent = isClosed ? '▾' : '▸';
          toggleButton.title = isClosed ? 'Hide per-model details' : 'Show per-model details';
        });
        sessionsBody.appendChild(tr);
        sessionsBody.appendChild(detailTr);
      });
      const suffix = filtered.length > MAX_SESSION_ROWS ? ' (showing first ' + MAX_SESSION_ROWS + ')' : '';
      sessionCountEl.textContent = filtered.length + ' of ' + sessions.length + ' sessions' + suffix;
    }

    function formatTurnLabel(turnIndex) { return 'Turn ' + String(Number(turnIndex) + 1); }

    function renderTurnDiscovery(baseSessions) {
      const body = document.getElementById('discoveryBody');
      if (!body) return;
      const rows = turnDiscovery
        .filter(r => { const ts = Number(r.lastTimeMs || r.firstTimeMs || 0); return ts > 0 && (globalFilter.fromMs === null || ts >= globalFilter.fromMs) && (globalFilter.toMs === null || ts <= globalFilter.toMs); })
        .filter(r => !discoveryState.onlyTools || Number(r.toolCalls || 0) > 0)
        .map(r => ({ ...r, inputTotal: Number(r.inputTokens || 0) + Number(r.cachedTokens || 0) }))
        .filter(r => !discoveryState.onlyAnomalies || isDiscoveryAnomaly(r))
        .sort((a, b) => compareValues(a[discoverySort.key], b[discoverySort.key], discoverySort.dir))
        .slice(0, 120);

      body.innerHTML = '';
      if (rows.length === 0) { body.innerHTML = '<tr><td colspan="8" style="color:var(--muted);padding:12px">No turn discovery data in this range. Turn discovery requires the agent-traces.db telemetry source (not JSONL fallback). Check the status bar for the active source.</td></tr>'; return; }

      rows.forEach(r => {
        const discoveryKey = getDiscoveryKey(r);
        const tr = document.createElement('tr');
        const toggleTd = document.createElement('td');
        const toggleButton = document.createElement('button');
        toggleButton.type = 'button'; toggleButton.textContent = '▸'; toggleButton.title = 'Show turn details';
        toggleButton.style.cssText = 'width:20px;height:20px;border:1px solid var(--border);background:var(--card-bg);color:var(--fg);border-radius:3px;cursor:pointer';
        toggleTd.appendChild(toggleButton);
        tr.appendChild(toggleTd);
        appendCell(tr, formatTurnLabel(r.turnIndex));
        appendCell(tr, r.chatSessionId.length > 12 ? (r.chatSessionId.slice(0, 6) + '…' + r.chatSessionId.slice(-4)) : r.chatSessionId, '', r.chatSessionId);
        appendCell(tr, Number(r.llmCalls || 0), 'num');
        appendCell(tr, Number(r.toolCalls || 0), 'num');
        appendCell(tr, formatCompactNumber(Number(r.inputTotal || 0)), 'num');
        appendCell(tr, formatCompactNumber(Number(r.outputTokens || 0)), 'num');
        const cacheTd = document.createElement('td');
        cacheTd.className = 'num';
        const cachePct = Number(r.cacheHitPct || 0);
        cacheTd.textContent = cachePct.toFixed(1) + '%';
        if (cachePct >= 70) cacheTd.style.color = '#81c784';
        else if (cachePct >= 40) cacheTd.style.color = '#ffb74d';
        else cacheTd.style.color = '#e57373';
        tr.appendChild(cacheTd);
        const detailTr = document.createElement('tr');
        const isOpen = discoveryState.expandAll || discoveryState.expandedKeys.has(discoveryKey);
        detailTr.style.display = isOpen ? '' : 'none';
        const detailTd = document.createElement('td');
        detailTd.colSpan = 8;
        const detailWrap = document.createElement('div');
        detailWrap.style.cssText = 'padding:10px 12px;background:var(--card-bg);border:1px solid var(--border);border-radius:4px';
        const lastActive = Number(r.lastTimeMs || 0) > 0 ? new Date(Number(r.lastTimeMs)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
        const models = Array.isArray(r.models) && r.models.length > 0 ? r.models.join(', ') : 'unknown';
        const agents = Array.isArray(r.agents) && r.agents.length > 0 ? r.agents.join(', ') : 'unknown';
        const tools = Array.isArray(r.tools) && r.tools.length > 0 ? r.tools.join(', ') : 'none';
        detailWrap.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">'
          + '<div style="font-size:11px;color:var(--muted)">Last active: ' + lastActive + ' · Session: ' + r.chatSessionId + '</div>'
          + '<button class="goto-session" data-session-id="' + r.chatSessionId + '" style="font-size:11px;border:1px solid var(--border);border-radius:4px;padding:3px 8px;background:var(--card-bg);color:var(--accent);cursor:pointer">Open in Sessions</button>'
          + '</div>'
          + '<div style="margin-top:8px;font-size:12px">'
          + '<div><strong>Models:</strong> ' + models + '</div>'
          + '<div><strong>Agents:</strong> ' + agents + '</div>'
          + '<div><strong>Tools:</strong> ' + tools + '</div>'
          + '</div>';
        detailTd.appendChild(detailWrap);
        detailTr.appendChild(detailTd);
        toggleButton.addEventListener('click', () => {
          const isClosed = detailTr.style.display === 'none';
          detailTr.style.display = isClosed ? '' : 'none';
          toggleButton.textContent = isClosed ? '▾' : '▸';
          toggleButton.title = isClosed ? 'Hide turn details' : 'Show turn details';
          if (isClosed) discoveryState.expandedKeys.add(discoveryKey);
          else discoveryState.expandedKeys.delete(discoveryKey);
        });
        if (isOpen) { toggleButton.textContent = '▾'; toggleButton.title = 'Hide turn details'; }
        body.appendChild(tr);
        body.appendChild(detailTr);
      });
    }

    function jumpToSession(sessionId) {
      if (!sessionId) return;
      switchToTab('sessions');
      switchSessionPane('table');
      rerenderAll();
      const row = Array.from(document.querySelectorAll('#sessionsBody tr')).find(el => el.dataset && el.dataset.sessionId === sessionId);
      if (!row) return;
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.style.outline = '1px solid var(--accent)';
      row.style.background = 'color-mix(in srgb, var(--accent) 14%, transparent)';
      setTimeout(() => { row.style.outline = ''; row.style.background = ''; }, 1600);
    }

    const budgetModelsBody = document.getElementById('budgetModelsBody');
    function renderBudgetModels(modelRows) {
      budgetModelsBody.innerHTML = '';
      modelRows.forEach(r => {
        const tr = document.createElement('tr');
        appendCell(tr, r.model);
        appendCell(tr, r.turns, 'num');
        appendCell(tr, r.credits.toFixed(1), 'num');
        appendCell(tr, r.pct.toFixed(1) + '%', 'num');
        budgetModelsBody.appendChild(tr);
      });
    }

    function updateTokensSummary(baseSessions, modelRows, insightDays) {
      const totalInput = insightDays.reduce((sum, d) => sum + d.input, 0);
      const totalCached = insightDays.reduce((sum, d) => sum + d.cached, 0);
      const totalOutput = insightDays.reduce((sum, d) => sum + d.output, 0);
      const totalTurns = baseSessions.reduce((sum, s) => sum + Number(s.turns || 0), 0);
      const billableInput = totalInput + totalCached;
      const totalTokens = billableInput + totalOutput;
      const cacheHitPct = billableInput > 0 ? (totalCached / billableInput) * 100 : 0;
      const ioRatio = totalOutput > 0 ? Math.round(billableInput / totalOutput) : 0;
      const avgPerTurn = totalTurns > 0 ? (totalTokens / totalTurns) : 0;
      const topModel = modelRows.reduce((top, row) => { if (!top || row.cost > top.cost) return row; return top; }, null);

      setText('tokensTotalInput', formatCompactNumber(billableInput));
      setText('tokensTotalInputSub', formatCompactNumber(totalInput) + ' net + ' + formatCompactNumber(totalCached) + ' cached');
      setText('tokensTotalCached', formatCompactNumber(totalCached));
      setText('tokensTotalCachedSub', 'cache hit ' + cacheHitPct.toFixed(1) + '%');
      setText('tokensTotalOutput', formatCompactNumber(totalOutput));
      setText('tokensTotalOutputSub', 'I:O ratio ' + (totalOutput > 0 ? ioRatio + ':1' : '—:1'));
      setText('tokensAvgPerTurn', formatCompactNumber(avgPerTurn));
      setText('tokensAvgPerTurnSub', totalTurns + ' turns in range');
      if (topModel) { setText('tokensTopModel', topModel.model); setText('tokensTopModelSub', '$' + topModel.cost.toFixed(2) + ' (' + topModel.pct.toFixed(1) + '%)'); }
      else { setText('tokensTopModel', 'N/A'); setText('tokensTopModelSub', '$0.00 (0.0%)'); }
    }

    const tokensBody = document.getElementById('tokensBody');
    function renderTokens(modelRows) {
      const rows = modelRows.map(r => {
        const avgCost = r.turns > 0 ? r.cost / r.turns : 0;
        const avgCredits = r.turns > 0 ? r.credits / r.turns : 0;
        const totalCostRounded = roundHalfUp(r.cost, 2);
        return { model: r.model, turns: r.turns, totalCost: r.cost, totalCostRounded, avgCost, avgCredits };
      }).filter(r =>
        includesFilter(r.model, getTextFilter('tokensFilterModel'))
        && includesFilter(r.turns, getTextFilter('tokensFilterTurns'))
        && includesFilter(r.totalCostRounded.toFixed(2), getTextFilter('tokensFilterCost'))
        && includesFilter(r.avgCost.toFixed(4), getTextFilter('tokensFilterAvgCost'))
        && includesFilter(r.avgCredits.toFixed(2), getTextFilter('tokensFilterAvgCredits'))
      ).sort((a, b) => compareValues(a[tokensSort.key], b[tokensSort.key], tokensSort.dir));

      tokensBody.innerHTML = '';
      rows.forEach(r => {
        const tr = document.createElement('tr');
        appendCell(tr, r.model);
        appendCell(tr, r.turns, 'num');
        appendCell(tr, '$' + r.totalCostRounded.toFixed(2), 'num');
        appendCell(tr, '$' + r.avgCost.toFixed(4), 'num');
        appendCell(tr, r.avgCredits.toFixed(2), 'num');
        tokensBody.appendChild(tr);
      });
    }

    function renderModelsWithState(modelRows) {
      const rows = modelRows.filter(r =>
        includesFilter(r.model, getTextFilter('modelsFilterModel'))
        && includesFilter(r.turns, getTextFilter('modelsFilterTurns'))
        && includesFilter(r.cost.toFixed(3), getTextFilter('modelsFilterCost'))
        && includesFilter(r.pct.toFixed(1), getTextFilter('modelsFilterPct'))
        && includesFilter(r.totalTokens, getTextFilter('modelsFilterTokens'))
        && includesFilter(r.cachePct.toFixed(1), getTextFilter('modelsFilterCachePct'))
        && includesFilter(r.avgMs, getTextFilter('modelsFilterAvg'))
        && includesFilter(r.tailMs, getTextFilter('modelsFilterTail'))
      ).sort((a, b) => compareValues(a[modelsSort.key], b[modelsSort.key], modelsSort.dir));
      renderModels(rows);
    }

    function bindSortHandlers(tabId, sortState, renderFn) {
      document.querySelectorAll('#' + tabId + ' th.sortable').forEach(th => {
        th.addEventListener('click', () => {
          const key = th.dataset.sort;
          if (!key) return;
          if (sortState.key === key) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
          else { sortState.key = key; sortState.dir = 'desc'; }
          renderFn();
        });
      });
    }

    function bindFilterInputs(ids, renderFn) {
      ids.forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('input', renderFn); });
    }

    function rerenderAll() {
      const baseSessions = getFilteredSessionsBase();
      const modelRowsFromSessions = getModelRowsFromSessions(baseSessions);
      const modelRows = modelRowsFromSessions.length > 0 ? modelRowsFromSessions : getFallbackModelRows();
      const filteredDailySeries = getFilteredDailySeries();
      const filteredInsightDays = getFilteredInsightDays();
      renderSessions(baseSessions);
      renderBudgetModels(modelRows);
      renderModelsWithState(modelRows);
      renderTokens(modelRows);
      renderAgentsForRange();
      updateTokensSummary(baseSessions, modelRows, filteredInsightDays);
      updateOverviewAndBudget(baseSessions, modelRows, filteredDailySeries, filteredInsightDays);
      renderInsightsFromRange(baseSessions);
      renderTurnDiscovery(baseSessions);
      document.getElementById('globalRangeSummary').textContent = getRangeSummary(globalFilter.fromMs, globalFilter.toMs);
    }

    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const btn = target.closest('.goto-session');
      if (!(btn instanceof HTMLElement)) return;
      const sessionId = btn.dataset.sessionId || '';
      if (sessionId) jumpToSession(sessionId);
    });

    const discoveryExpandAllBtn = document.getElementById('discoveryExpandAll');
    const discoveryCollapseAllBtn = document.getElementById('discoveryCollapseAll');
    const discoveryOnlyToolsEl = document.getElementById('discoveryOnlyTools');
    const discoveryOnlyAnomaliesEl = document.getElementById('discoveryOnlyAnomalies');

    if (discoveryOnlyToolsEl) { discoveryOnlyToolsEl.checked = discoveryState.onlyTools; discoveryOnlyToolsEl.addEventListener('change', () => { discoveryState.onlyTools = Boolean(discoveryOnlyToolsEl.checked); rerenderAll(); }); }
    if (discoveryOnlyAnomaliesEl) { discoveryOnlyAnomaliesEl.checked = discoveryState.onlyAnomalies; discoveryOnlyAnomaliesEl.addEventListener('change', () => { discoveryState.onlyAnomalies = Boolean(discoveryOnlyAnomaliesEl.checked); rerenderAll(); }); }
    if (discoveryExpandAllBtn) { discoveryExpandAllBtn.addEventListener('click', () => { discoveryState.expandAll = true; rerenderAll(); }); }
    if (discoveryCollapseAllBtn) { discoveryCollapseAllBtn.addEventListener('click', () => { discoveryState.expandAll = false; discoveryState.expandedKeys.clear(); rerenderAll(); }); }

    bindSortHandlers('tab-sessions', sessionsSort, rerenderAll);
    bindSortHandlers('tab-models', modelsSort, rerenderAll);
    bindSortHandlers('tab-tokens', tokensSort, rerenderAll);
    bindSortHandlers('sessions-pane-discovery', discoverySort, rerenderAll);

    bindFilterInputs(['sessionsFilterDate','sessionsFilterModel','sessionsFilterTurns','sessionsFilterCost','sessionsFilterCredits','sessionsFilterTokens','sessionsFilterCachePct','sessionsFilterLatency'], rerenderAll);
    bindFilterInputs(['modelsFilterModel','modelsFilterTurns','modelsFilterCost','modelsFilterPct','modelsFilterTokens','modelsFilterCachePct','modelsFilterAvg','modelsFilterTail'], rerenderAll);
    bindFilterInputs(['tokensFilterModel','tokensFilterTurns','tokensFilterCost','tokensFilterAvgCost','tokensFilterAvgCredits'], rerenderAll);

    document.querySelectorAll('#overviewChartMode button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#overviewChartMode button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        overviewChartMode = btn.dataset.mode || 'cost';
        rerenderAll();
      });
    });

    document.querySelectorAll('.global-filter-bar .preset').forEach(btn => {
      btn.addEventListener('click', () => { applyPreset(btn.dataset.preset || 'period'); });
    });

    document.getElementById('globalApply').addEventListener('click', () => {
      const fromVal = document.getElementById('globalFrom').value;
      const toVal = document.getElementById('globalTo').value;
      globalFilter.preset = 'custom';
      globalFilter.fromMs = fromVal ? new Date(fromVal).getTime() : null;
      globalFilter.toMs = toVal ? new Date(toVal).getTime() + 59999 : null;
      document.querySelectorAll('.global-filter-bar .preset').forEach(btn => btn.classList.remove('active'));
      rerenderAll();
    });

    document.getElementById('globalReset').addEventListener('click', () => { applyPreset('period'); });

    // Heatmap
    const heatmapData = ${heatmapData};
    const heatmapGrid = document.getElementById('heatmapGrid');
    const costColors = ['var(--border)', '#0e4429', '#006d32', '#26a641', '#39d353'];
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const CELL_STEP = 15;

    function renderHeatmap(mode) {
      const numWeeks = Math.ceil(heatmapData.length / 7);
      const monthsEl = document.getElementById('heatmapMonths');
      monthsEl.innerHTML = '';
      let lastMonth = -1;
      for (let week = 0; week < numWeeks; week++) {
        const idx = week * 7;
        const span = document.createElement('span');
        span.style.minWidth = CELL_STEP + 'px';
        span.style.display = 'inline-block';
        if (idx < heatmapData.length) {
          const d = new Date(heatmapData[idx].date + 'T00:00:00');
          const month = d.getMonth();
          if (month !== lastMonth) { span.textContent = MONTH_NAMES[month]; lastMonth = month; }
        }
        monthsEl.appendChild(span);
      }
      const dayLabelsEl = document.getElementById('heatmapDayLabels');
      dayLabelsEl.innerHTML = '';
      ['Mon','','Wed','','Fri','',''].forEach(name => {
        const span = document.createElement('span');
        span.className = 'heatmap-day-label';
        span.textContent = name;
        dayLabelsEl.appendChild(span);
      });
      heatmapGrid.innerHTML = '';
      const values = heatmapData.map(d => mode === 'cost' ? d.cost : d.turns);
      const maxVal = Math.max(...values, 0.001);
      for (let week = 0; week < numWeeks; week++) {
        const col = document.createElement('div');
        col.className = 'heatmap-col';
        for (let day = 0; day < 7; day++) {
          const idx = week * 7 + day;
          const cell = document.createElement('div');
          cell.className = 'heatmap-cell';
          if (idx < values.length) {
            const intensity = values[idx] / maxVal;
            const level = intensity === 0 ? 0 : intensity < 0.25 ? 1 : intensity < 0.5 ? 2 : intensity < 0.75 ? 3 : 4;
            cell.style.background = costColors[level];
            cell.title = heatmapData[idx].date + ': ' + (mode === 'cost' ? '$' + values[idx].toFixed(3) : values[idx] + ' turns');
          }
          col.appendChild(cell);
        }
        heatmapGrid.appendChild(col);
      }
    }

    renderHeatmap('cost');
    document.querySelectorAll('#heatmapToggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#heatmapToggle button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderHeatmap(btn.dataset.mode);
      });
    });

    // Insights charts
    const ioRatioLabels = ${ioRatioLabels};
    const ioNetInputData = ${ioNetInput};
    const ioCachedData = ${ioCached};
    const ioOutputData = ${ioOutput};

    const tokenTrendChartInst = new Chart(document.getElementById('tokenTrendChart'), {
      type: 'bar',
      data: {
        labels: ioRatioLabels,
        datasets: [
          { label: 'Cached Input', data: ioCachedData, backgroundColor: 'rgba(79,195,247,0.55)', stack: 'input' },
          { label: 'Net Input', data: ioNetInputData, backgroundColor: 'rgba(79,195,247,0.25)', stack: 'input' },
          { label: 'Output', data: ioOutputData, backgroundColor: 'rgba(129,199,132,0.75)', stack: 'output' },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked: true, ticks: { color: textColor, maxTicksLimit: 8, font: { size: 10 } }, grid: { color: gridColor } },
          y: { stacked: false, ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor }, title: { display: true, text: 'Tokens', color: textColor, font: { size: 10 } } }
        },
        plugins: { legend: { labels: { color: textColor, font: { size: 11 } } } }
      }
    });

    function getFilteredInsightDays() {
      const days = [];
      for (let i = 0; i < ioRatioLabels.length; i++) {
        const dayTs = new Date(ioRatioLabels[i] + 'T00:00:00').getTime();
        const dayEndTs = dayTs + 86399999;
        if ((globalFilter.fromMs === null || dayEndTs >= globalFilter.fromMs) && (globalFilter.toMs === null || dayTs <= globalFilter.toMs)) {
          days.push({ period: ioRatioLabels[i], input: Number(ioNetInputData[i] || 0), cached: Number(ioCachedData[i] || 0), output: Number(ioOutputData[i] || 0) });
        }
      }
      return days;
    }

    function renderInsightsFromRange(baseSessions) {
      const insightDays = getFilteredInsightDays();
      const totalInput = insightDays.reduce((sum, d) => sum + d.input, 0);
      const totalCached = insightDays.reduce((sum, d) => sum + d.cached, 0);
      const totalOutput = insightDays.reduce((sum, d) => sum + d.output, 0);
      const totalBillableInput = totalInput + totalCached;
      const totalTurns = baseSessions.reduce((sum, s) => sum + Number(s.turns || 0), 0);
      const cacheHitPct = totalBillableInput > 0 ? (totalCached / totalBillableInput) * 100 : 0;
      const avgInputPerTurn = totalTurns > 0 ? Math.round((totalBillableInput / totalTurns) / 100) / 10 : 0;
      const ioRatio = totalOutput > 0 ? Math.round(totalBillableInput / totalOutput) + ':1' : '—:1';
      const cacheColor = cacheHitPct >= 70 ? '#81c784' : cacheHitPct >= 40 ? '#ffb74d' : '#e57373';
      const avgNote = avgInputPerTurn > 20 ? 'High context load in this range' : 'within normal range';

      setText('insightCacheHitValue', cacheHitPct.toFixed(1) + '%');
      setText('insightCacheHitSub', (totalCached / 1000).toFixed(0) + 'K cached of ' + (totalBillableInput / 1000).toFixed(0) + 'K total input');
      const cacheHitValueEl = document.getElementById('insightCacheHitValue');
      if (cacheHitValueEl) cacheHitValueEl.style.color = cacheColor;
      const cacheHitFillEl = document.getElementById('insightCacheHitFill');
      if (cacheHitFillEl) { cacheHitFillEl.style.width = Math.min(100, cacheHitPct).toFixed(1) + '%'; cacheHitFillEl.style.background = cacheColor; }
      setText('insightIoRatioValue', ioRatio);
      setText('insightIoRatioSub', (totalBillableInput / 1000).toFixed(0) + 'K in · ' + (totalOutput / 1000).toFixed(0) + 'K out');
      setText('insightAvgInputValue', avgInputPerTurn.toFixed(1) + 'K');
      setText('insightAvgInputSub', avgNote);
      const avgInputEl = document.getElementById('insightAvgInputValue');
      if (avgInputEl) avgInputEl.style.cssText = avgInputPerTurn > 20 ? 'color:#e57373' : '';
      setText('insightTokenFlowTitle', 'Token Flow — ' + getRangePresetLabel() + ' (stacked)');
      tokenTrendChartInst.data.labels = insightDays.map(d => d.period);
      tokenTrendChartInst.data.datasets[0].data = insightDays.map(d => d.cached);
      tokenTrendChartInst.data.datasets[1].data = insightDays.map(d => d.input);
      tokenTrendChartInst.data.datasets[2].data = insightDays.map(d => d.output);
      tokenTrendChartInst.update();

      const rangeAlerts = [];
      if (cacheHitPct < 40 && totalBillableInput > 5000) rangeAlerts.push('Low cache reuse in this range. Keep related tasks in one session to improve hit rate.');
      if (avgInputPerTurn > 20) rangeAlerts.push('High input per turn. Reduce attached context and split very broad prompts.');
      if (totalOutput > 0 && (totalBillableInput / Math.max(1, totalOutput)) > 8) rangeAlerts.push('High input-to-output ratio. Consider tighter prompts and smaller context windows.');
      const alertsContainer = document.getElementById('insightsRangeAlerts');
      if (alertsContainer) {
        alertsContainer.innerHTML = rangeAlerts.length === 0
          ? '<div style="padding:8px 10px;border:1px solid var(--border);border-radius:4px;background:var(--card-bg);font-size:12px;color:var(--muted)">No range-specific token concerns detected.</div>'
          : rangeAlerts.map((msg, idx) => '<div style="padding:8px 10px;border:1px solid var(--border);border-left:3px solid #ffb74d;border-radius:4px;background:var(--card-bg);font-size:12px;margin-bottom:6px"><strong>Token Alert ' + (idx + 1) + ':</strong> ' + msg + '</div>').join('');
      }
    }

    const surfaceLabels = ${surfaceLabels};
    const surfaceInputs = ${surfaceInputs};
    if (surfaceLabels.length > 0) {
      new Chart(document.getElementById('surfacePieChart'), {
        type: 'doughnut',
        data: { labels: surfaceLabels, datasets: [{ data: surfaceInputs, backgroundColor: colors.slice(0, surfaceLabels.length) }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: textColor, font: { size: 11 } }, position: 'right' } } }
      });
    }

    const surfaceCostLabels = ${surfaceCostLabels};
    const surfaceCostData = ${surfaceCostData};
    if (surfaceCostLabels.length > 0) {
      new Chart(document.getElementById('surfaceCostPieChart'), {
        type: 'doughnut',
        data: { labels: surfaceCostLabels, datasets: [{ data: surfaceCostData, backgroundColor: colors.slice(0, surfaceCostLabels.length) }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: textColor, font: { size: 11 } }, position: 'right' },
            tooltip: { callbacks: { label: (ctx) => { const total = ctx.dataset.data.reduce((a, b) => a + b, 0); const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0'; return ctx.label + ': $' + ctx.parsed.toFixed(3) + ' (' + pct + '%)'; } } }
          }
        }
      });
    }

    renderAgentsForRange();
    applyPreset('period');
  </script>
</body>
</html>`;
}
