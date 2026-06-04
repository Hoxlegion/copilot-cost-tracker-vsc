import * as vscode from "vscode";
import { CostDatabase, InsightMetrics } from "../database";
import { PricingEngine } from "../pricing";
import { TracesDbReader, SurfaceBreakdown } from "../parser";
import { DashboardAlert } from "../insights";
import { DashboardDataAssembler, DashboardRawData } from "./dashboardDataAssembler";

export class DashboardPanel {
  private static _currentPanel: DashboardPanel | undefined;

  public static get currentPanel(): DashboardPanel | undefined {
    return this._currentPanel;
  }

  private static set currentPanel(value: DashboardPanel | undefined) {
    this._currentPanel = value;
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly database: CostDatabase;
  private readonly assembler: DashboardDataAssembler;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    database: CostDatabase,
    pricing: PricingEngine,
    reader: TracesDbReader
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.database = database;
    this.assembler = new DashboardDataAssembler(database, reader);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    database: CostDatabase,
    pricing: PricingEngine,
    reader: TracesDbReader
  ): void {
    const column = vscode.ViewColumn.Beside;

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(column);
      void DashboardPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "copilotCostDashboard",
      "Copilot Cost Dashboard",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "media"),
          vscode.Uri.joinPath(extensionUri, "dist"),
        ],
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(
      panel,
      extensionUri,
      database,
      pricing,
      reader
    );
    void DashboardPanel.currentPanel.update();
  }

  public async update(): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration("copilotCostTracker");
      const billingCycleStartDay = config.get<number>("billingCycleStartDay", 1);

      const rawData = await this.assembler.assemble(billingCycleStartDay);
      this.panel.webview.html = this.getHtmlContent(rawData);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.html = `<!DOCTYPE html><html><body style="font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background);"><h3>Dashboard failed to render</h3><p>${message.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p><p>Open Developer Tools or reload the window after updating the extension.</p></body></html>`;
    }
  }

  private getHtmlContent(rawData: DashboardRawData): string {
    const nonce = this.createNonce();
    const cspSource = this.panel.webview.cspSource;

    // Extract raw data into local vars for backward compatibility with existing template
    const { insightMetrics, alerts, playbook, surfaceData, monthTotal, dailyCosts, dailyCostsForRange, insightMetricsFullRange, modelBreakdown, agentBreakdown, dailyAgentBreakdown, allSessions, billingPeriodStartMs, billingPeriodEndMs, periodCredits, periodAggregate } = rawData;

    const sessionCount = allSessions.length;
    const agentBreakdownSliced = agentBreakdown.slice(0, 12);

    // Multi-period model data for Models tab period filter
    const modelDataByPeriod = {
      "1d":  this.buildModelPeriodData(1),
      "7d":  this.buildModelPeriodData(7),
      "30d": this.buildModelPeriodData(30),
      "90d": this.buildModelPeriodData(90),
    };

    // Average response time from 30-day latency samples
    const allLatencySamples = this.database.getModelLatencySamples(30);
    const avgResponseMs = allLatencySamples.length > 0
      ? Math.round(allLatencySamples.reduce((s, x) => s + x.duration, 0) / allLatencySamples.length)
      : 0;
    const avgResponseLabel = avgResponseMs >= 1000
      ? (avgResponseMs / 1000).toFixed(1) + "s"
      : avgResponseMs + "ms";

    const config = vscode.workspace.getConfiguration("copilotCostTracker");
    const budgetCredits = config.get<number>("budgetCredits", 180);

    // Today & week data
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset).getTime();
    const today = this.database.getCostSince(todayStart);
    const week = this.database.getCostSince(weekStart);

    const dailyLabels = JSON.stringify(dailyCosts.map((d) => d.period).reverse());
    const dailyData = JSON.stringify(dailyCosts.map((d) => d.totalCostUsd).reverse());
    const dailyCreditsData = JSON.stringify(dailyCosts.map((d) => d.totalCredits).reverse());

    const modelLabels = JSON.stringify(modelBreakdown.map((m) => m.model));
    const modelCostData = JSON.stringify(modelBreakdown.map((m) => m.totalCostUsd));
    const modelTurnData = JSON.stringify(modelBreakdown.map((m) => m.turnCount));
    const modelPctData = JSON.stringify(modelBreakdown.map((m) => m.percentage));
    const agentBreakdownData = JSON.stringify(agentBreakdownSliced);
    const dailyAgentBreakdownData = JSON.stringify(dailyAgentBreakdown);

    const usage = this.getUsagePresentation(periodCredits, budgetCredits);
    const usagePct = usage.usagePct;

    // Days remaining in period
    const budgetDetails = this.getBudgetDetails(billingPeriodStartMs, billingPeriodEndMs, periodAggregate.turns, periodCredits, budgetCredits);
    const daysRemaining = budgetDetails.daysRemaining;
    const dailyBudgetRemaining = budgetDetails.dailyBudgetRemaining;
    const burnRate = budgetDetails.burnRate;
    const projectedPeriodCredits = budgetDetails.projectedPeriodCredits;
    const forecastVisible = budgetDetails.forecastVisible;
    const forecastOverage = budgetDetails.forecastOverage;

    // Heatmap data: last 12 weeks, 7 days each
    const heatmapData = this.buildHeatmapData(dailyCostsForRange);
    const dailyRangeSeriesJson = JSON.stringify(dailyCostsForRange.map((d) => ({
      period: d.period,
      cost: d.totalCostUsd,
      credits: d.totalCredits,
      turns: d.turnCount,
    })));

    // ── Insights tab data ─────────────────────────────────────────────────────
    const insightView = this.buildInsightViewData(insightMetrics);
    const totalBillableInput30d = insightView.totalBillableInput30d;
    const avgInputPerTurn = insightView.avgInputPerTurn;
    const ioRatioLabels = JSON.stringify(insightMetricsFullRange.ioRatioDays.map(d => d.period));
    const ioNetInput    = JSON.stringify(insightMetricsFullRange.ioRatioDays.map(d => d.inputTokens));
    const ioCached      = JSON.stringify(insightMetricsFullRange.ioRatioDays.map(d => d.cachedTokens));
    const ioOutput      = JSON.stringify(insightMetricsFullRange.ioRatioDays.map(d => d.outputTokens));

    // Surface breakdown — filter out zero-token entries and cap at 6 slices
    const meaningfulSurfaces = this.getMeaningfulSurfaces(surfaceData);
    const surfaceLabels = JSON.stringify(meaningfulSurfaces.map(s => s.label));
    const surfaceInputs = JSON.stringify(meaningfulSurfaces.map(s => s.inputTokens + s.cachedTokens));

    // ── Estimates tab data ────────────────────────────────────────────────────
    const estimateData = this.buildEstimateData(insightMetrics, monthTotal.costUsd);
    const estHoursSaved = estimateData.estHoursSaved;
    const costPerOutputK = estimateData.costPerOutputK;
    const outputTokensK = estimateData.outputTokensK;
    const inputOverheadPct = estimateData.inputOverheadPct;

    // Pre-compute style values to avoid nested ternaries in template literals
    const insightStyles = this.getInsightStyles(insightMetrics, totalBillableInput30d, avgInputPerTurn);
    const cacheHitColor = insightStyles.cacheHitColor;
    const avgInputStyle = insightStyles.avgInputStyle;
    const avgInputNote = insightStyles.avgInputNote;
    const errorStyle = insightStyles.errorStyle;
    const errorNote = insightStyles.errorNote;
    const ioRatioLabel = insightStyles.ioRatioLabel;

    // ── Alert cards HTML ──────────────────────────────────────────────────────
    const alertCardsHtml = this.buildAlertCardsHtml(alerts);

    // ── Playbook table HTML ───────────────────────────────────────────────────
    const playbookRowsHtml = playbook.map(r =>
      `<tr>
        <td><strong>${r.strategy}</strong></td>
        <td>${r.statusEmoji} ${r.statusLabel}</td>
        <td style="color:var(--muted)">${r.metricDesc}</td>
        <td style="color:var(--muted)">${r.impact}</td>
      </tr>`
    ).join('\n');

    // Sessions table data — send all (up to 1000) with raw timestamps for client-side filtering
    const sessionsJson = JSON.stringify(allSessions.map((s) => ({
      ts: s.startTimestamp,
      model: s.primaryModel,
      turns: s.turnCount,
      costUsd: s.totalCostUsd,
      credits: s.totalCredits,
      inputTokens: s.totalInputTokens,
      outputTokens: s.totalOutputTokens,
      cachedTokens: s.totalCachedTokens,
      totalTokens: s.totalInputTokens + s.totalOutputTokens + s.totalCachedTokens,
      avgLatencyMs: Math.round(s.avgDurationMs),
    })));

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; font-src ${cspSource};">
  <title>Copilot Cost Dashboard</title>
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border);
      --card-bg: var(--vscode-editorWidget-background);
      --accent: var(--vscode-progressBar-background);
      --tab-active: var(--vscode-tab-activeBackground);
      --tab-inactive: var(--vscode-tab-inactiveBackground);
      --muted: var(--vscode-descriptionForeground);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--fg);
      background: var(--bg);
    }

    /* Header bar */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
    }
    .header h1 { font-size: 14px; font-weight: 600; }
    .header .stats {
      display: flex;
      gap: 16px;
      font-size: 12px;
      color: var(--muted);
    }
    .header .stats .val { font-weight: 600; color: var(--fg); }

    /* Tabs */
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
      padding: 0 16px;
    }
    .tab {
      padding: 8px 14px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      font-size: 12px;
      color: var(--muted);
      transition: all 0.15s;
    }
    .tab:hover { color: var(--fg); }
    .tab.active {
      color: var(--fg);
      border-bottom-color: var(--accent);
      font-weight: 600;
    }

    /* Tab content */
    .tab-content { display: none; padding: 16px; }
    .tab-content.active { display: block; }

    /* Stat cards */
    .stat-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 10px;
      margin-bottom: 16px;
    }
    .stat {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 10px 12px;
    }
    .stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.3px; }
    .stat-value { font-size: 20px; font-weight: 700; margin-top: 2px; }
    .stat-sub { font-size: 11px; color: var(--muted); margin-top: 1px; }

    /* Progress */
    .budget-bar {
      width: 100%;
      height: 6px;
      background: var(--border);
      border-radius: 3px;
      margin-top: 6px;
      overflow: hidden;
    }
    .budget-fill {
      height: 100%;
      background: var(--accent);
      border-radius: 3px;
    }

    .chart-section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: var(--muted);
      margin-bottom: 6px;
    }

    .chart-wrap {
      position: relative;
      width: 100%;
      height: 260px;
      margin: 12px 0;
    }
    .chart-grid {
      display: grid;
      grid-template-columns: 1.5fr 1fr;
      gap: 16px;
    }

    /* Heatmap */
    .heatmap {
      display: flex;
      gap: 2px;
    }
    .heatmap-col {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .heatmap-cell {
      width: 13px;
      height: 13px;
      border-radius: 2px;
      background: var(--border);
      flex-shrink: 0;
    }
    .heatmap-day-label {
      height: 13px;
      line-height: 13px;
      display: flex;
      align-items: center;
      font-size: 10px;
      color: var(--muted);
    }
    .heatmap-legend {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 8px;
      font-size: 11px;
      color: var(--muted);
    }
    .heatmap-legend .cell {
      width: 13px;
      height: 13px;
      border-radius: 2px;
    }
    .heatmap-labels {
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: 10px;
      color: var(--muted);
      margin-right: 4px;
      justify-content: flex-start;
      padding-top: 0;
    }
    .heatmap-labels span { height: 18px; display: flex; align-items: center; }
    .heatmap-toggle {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
    }
    .heatmap-toggle button {
      padding: 3px 10px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--fg);
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
    }
    .heatmap-toggle button.active {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .period-toggle {
      display: flex;
      gap: 4px;
    }
    .period-toggle button {
      padding: 3px 10px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--fg);
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
    }
    .period-toggle button.active {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }

    /* Table */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th, td {
      padding: 6px 10px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      font-weight: 600;
      font-size: 11px;
      color: var(--muted);
      text-transform: uppercase;
    }
    th.sortable {
      cursor: pointer;
      user-select: none;
    }
    .table-filter-row th {
      padding: 4px 8px;
      border-bottom: 1px solid var(--border);
      background: var(--card-bg);
      text-transform: none;
    }
    .table-filter-row input {
      width: 100%;
      font-size: 11px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 3px 6px;
    }
    tr:hover { background: var(--card-bg); }
    .num { text-align: right; font-variant-numeric: tabular-nums; }

    .global-filter-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      background: color-mix(in srgb, var(--card-bg) 60%, transparent);
    }
    .global-filter-bar .label {
      font-size: 11px;
      color: var(--muted);
      margin-right: 2px;
    }
    .global-filter-bar button,
    .global-filter-bar input {
      font-size: 11px;
      border-radius: 4px;
    }
    .global-filter-bar .preset {
      padding: 3px 10px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--fg);
      cursor: pointer;
    }
    .global-filter-bar .preset.active {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    .global-filter-bar input {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--border);
      padding: 3px 6px;
    }
    .global-filter-bar .action {
      padding: 3px 10px;
      border: none;
      cursor: pointer;
    }
    .global-filter-bar .apply {
      background: var(--accent);
      color: #fff;
    }
    .global-filter-bar .reset {
      background: var(--border);
      color: var(--fg);
    }

    /* Help Button & Modal */
    .help-button {
      background: transparent;
      border: 1px solid var(--border);
      cursor: pointer;
      color: var(--muted);
      padding: 6px 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      transition: all 0.2s ease;
      min-width: 32px;
      min-height: 32px;
    }
    .help-button:hover {
      background-color: var(--card-bg);
      color: var(--accent);
      border-color: var(--accent);
      transform: scale(1.05);
    }
    .help-button:active {
      transform: scale(0.98);
    }

    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 1000;
    }
    .modal.show {
      display: flex;
    }
    .modal-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      cursor: pointer;
    }
    .modal-content {
      position: relative;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      width: 90%;
      max-width: 700px;
      max-height: 80vh;
      overflow-y: auto;
      margin: auto;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      background: var(--bg);
    }
    .modal-header h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
    }
    .modal-close {
      background: transparent;
      border: none;
      cursor: pointer;
      color: var(--muted);
      padding: 4px;
      display: flex;
      align-items: center;
      border-radius: 4px;
      transition: color 0.2s;
    }
    .modal-close:hover {
      color: var(--fg);
    }
    .modal-body {
      padding: 20px;
    }
    .help-section {
      margin-bottom: 20px;
    }
    .help-section:last-child {
      margin-bottom: 0;
    }
    .help-section h3 {
      margin: 0 0 10px 0;
      font-size: 14px;
      font-weight: 600;
    }
    .help-section p {
      margin: 8px 0;
      font-size: 13px;
      line-height: 1.5;
      color: var(--fg);
    }
    .help-section ul {
      margin: 8px 0;
      padding-left: 20px;
      font-size: 13px;
      line-height: 1.6;
    }
    .help-section li {
      margin: 4px 0;
    }
    .help-section code {
      background: var(--card-bg);
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
      font-size: 12px;
    }
  </style>
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

  <!-- Tabs -->
  <div class="tabs">
    <div class="tab active" data-tab="overview">Overview</div>
    <div class="tab" data-tab="budget">Budget</div>
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
  </div>

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
        <div class="stat-label">LLM Calls</div>
        <div class="stat-value" id="overviewCallCount">${monthTotal.turns}</div>
        <div class="stat-sub" id="overviewCallCountSub">turns in range</div>
      </div>
      <div class="stat">
        <div class="stat-label">Avg Response</div>
        <div class="stat-value">${avgResponseLabel}</div>
        <div class="stat-sub">last 30 days</div>
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
    <!-- Activity heatmap — full-width below cost chart -->
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

  <!-- Budget Health (D17) -->
  <div class="tab-content" id="tab-budget">
    <div class="stat-row">
      <div class="stat">
        <div class="stat-label" id="budgetUsedLabel">Range Used</div>
        <div class="stat-value" id="budgetUsageValue">${usagePct}%</div>
        <div class="stat-sub" id="budgetUsageSub">${periodCredits.toFixed(0)} / ${budgetCredits} cr</div>
        <div class="budget-bar"><div class="budget-fill" id="budgetUsageFill" style="width:${Math.min(100, Number.parseFloat(usagePct))}%;background:${this.getBudgetColor(Number.parseFloat(usagePct))}" ></div></div>
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
        ${this.getForecastHtml(forecastVisible, projectedPeriodCredits, burnRate, forecastOverage)}
      </div>
      <div class="stat">
        <div class="stat-label">Token Density (Range)</div>
        <div class="stat-value" id="budgetTokenDensity">0</div>
        <div class="stat-sub" id="budgetTokenDensitySub">tokens per credit</div>
      </div>
    </div>
    <h3 style="margin:12px 0 8px;font-size:12px;text-transform:uppercase;color:var(--muted)" id="budgetModelTitle">Model Breakdown (Current Range)</h3>
    <table>
      <thead>
        <tr><th>Model</th><th class="num">Turns</th><th class="num">Credits</th><th class="num">%</th></tr>
      </thead>
      <tbody id="budgetModelsBody"></tbody>
    </table>
  </div>

  <!-- Sessions -->
  <div class="tab-content" id="tab-sessions">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px"><span id="sessionCount" style="font-size:11px;color:var(--muted)"></span></div>
    <table>
      <thead>
        <tr>
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
      <thead>
        <tr><th>Agent</th><th class="num">Turns</th><th class="num">Credits</th><th class="num">Cost (USD)</th><th class="num">%</th></tr>
      </thead>
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
    <div style="margin-bottom:16px">
      ${alertCardsHtml}
    </div>
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
        <div class="stat-sub" id="insightCacheHitSub">${(insightMetrics.totalCachedTokens / 1000).toFixed(0)}K cached of ${((insightMetrics.totalInputTokens + insightMetrics.totalCachedTokens) / 1000).toFixed(0)}K total input</div>
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
        <div class="chart-section-title">Cost by Surface (total input tokens)</div>
        <div class="chart-wrap" style="display:flex;align-items:center;justify-content:center">
          ${this.getSurfacePieHtml(meaningfulSurfaces.length > 0)}
        </div>
      </div>
    </div>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
      <div class="chart-section-title" style="margin-bottom:8px">Cache Hit Rate Interpretation</div>
      <table>
        <thead><tr><th>Rate</th><th>Meaning</th><th>Action</th></tr></thead>
        <tbody>
          <tr><td>>70%</td><td>Excellent — context is being reused efficiently</td><td>No action needed</td></tr>
          <tr><td>40–70%</td><td>Moderate — some context churn</td><td>Reuse the same files across sessions where possible</td></tr>
          <tr><td><40%</td><td>Poor — context is being rebuilt on every prompt</td><td>Open fewer unique files per session; avoid large one-off pastes</td></tr>
        </tbody>
      </table>
    </div>
    </div><!-- end 30d stats wrapper -->
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
        <tr>
          <td>Time Saved</td>
          <td><code>min(output_chars ÷ 175 CPM, turns × 2 min)</code></td>
          <td>1 token ≈ 4 chars; developer codes at 175 chars/min</td>
          <td>No acceptance rate — assumes 100% of output is used</td>
        </tr>
        <tr>
          <td>Cost per Output-K</td>
          <td><code>monthly_cost ÷ (output_tokens ÷ 1000)</code></td>
          <td>Linear cost-per-token relationship</td>
          <td>Cached tokens reduce cost but are excluded from denominator</td>
        </tr>
        <tr>
          <td>Input Overhead</td>
          <td><code>(input + cached) ÷ (input + cached + output)</code></td>
          <td>All token categories reported by the API</td>
          <td>High values (&gt;90%) are normal for agent workflows with large context</td>
        </tr>
      </tbody>
    </table>
    <div style="margin-top:16px;padding:10px 14px;background:var(--vscode-editorWidget-background);border-radius:4px;font-size:11px;color:var(--muted)">
      <strong>What is not tracked:</strong> Acceptance rate (ghost text Tab/Esc), retained lines of code after editing, copy/insert events from chat panel, and per-request HTTP error codes. These require hooks into Copilot internals that are not exposed to third-party extensions.
    </div>
  </div>

  <script nonce="${nonce}">
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
      });
    });

    // Help modal
    const helpButton = document.getElementById('helpButton');
    const helpModal = document.getElementById('helpModal');
    const closeHelpButton = document.getElementById('closeHelpButton');
    const modalOverlay = helpModal.querySelector('.modal-overlay');

    if (helpButton) {
      helpButton.addEventListener('click', () => {
        helpModal.classList.add('show');
      });
    }

    if (closeHelpButton) {
      closeHelpButton.addEventListener('click', () => {
        helpModal.classList.remove('show');
      });
    }

    if (modalOverlay) {
      modalOverlay.addEventListener('click', () => {
        helpModal.classList.remove('show');
      });
    }

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && helpModal.classList.contains('show')) {
        helpModal.classList.remove('show');
      }
    });

    const textColor = getComputedStyle(document.body).getPropertyValue('color') || '#ccc';
    const gridColor = 'rgba(128,128,128,0.15)';
    const budgetCredits = ${budgetCredits};
    const billingPeriodStartMs = ${billingPeriodStartMs};

    function appendCell(tr, value, className, title) {
      const td = document.createElement('td');
      if (className) {
        td.className = className;
      }
      td.textContent = String(value ?? '');
      if (title) {
        td.title = String(title);
      }
      tr.appendChild(td);
    }

    const dailyRangeSeries = ${dailyRangeSeriesJson};

    // Daily chart
    const dailyChartInst = new Chart(document.getElementById('dailyChart'), {
      type: 'line',
      data: {
        labels: ${dailyLabels},
        datasets: [{
          label: 'Cost (USD)',
          data: ${dailyData},
          borderColor: '#4fc3f7',
          backgroundColor: 'rgba(79,195,247,0.08)',
          fill: true,
          tension: 0.3,
          pointRadius: 2,
        }, {
          label: 'Credits',
          data: ${dailyCreditsData},
          borderColor: '#81c784',
          fill: false,
          tension: 0.3,
          pointRadius: 2,
          yAxisID: 'y2',
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { color: textColor, maxTicksLimit: 8, font: { size: 10 } }, grid: { color: gridColor } },
          y: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor }, title: { display: true, text: 'USD', color: textColor, font: { size: 10 } } },
          y2: { position: 'right', ticks: { color: textColor, font: { size: 10 } }, grid: { display: false }, title: { display: true, text: 'Credits', color: textColor, font: { size: 10 } } }
        },
        plugins: { legend: { labels: { color: textColor, font: { size: 11 } } } }
      }
    });

    // Per-period model data retained for fallback if no sessions are available
    const modelDataByPeriod = ${JSON.stringify(modelDataByPeriod)};
    const colors = ['#4fc3f7','#81c784','#ffb74d','#e57373','#ba68c8','#4db6ac','#fff176','#90a4ae'];

    // 30-day arrays kept for Tokens tab
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
    const MAX_SESSION_ROWS = 500;
    const globalFilter = {
      preset: 'period',
      fromMs: null,
      toMs: null,
    };

    const sessionsSort = { key: 'ts', dir: 'desc' };
    const modelsSort = { key: 'cost', dir: 'desc' };
    const tokensSort = { key: 'totalCost', dir: 'desc' };
    let overviewChartMode = 'cost';

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
      if (preset === 'today') {
        const d = new Date();
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        return { fromMs: start, toMs: now };
      }
      if (preset === '30d') {
        return { fromMs: now - 30 * msDay, toMs: now };
      }
      if (preset === 'period') {
        return { fromMs: billingPeriodStartMs, toMs: now };
      }
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
      const fromLabel = fromMs ? formatSessionDate(fromMs) : 'any';
      const toLabel = toMs ? formatSessionDate(toMs) : 'now';
      return fromLabel + ' → ' + toLabel;
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
        const dayEndTs = dayTs + (24 * 60 * 60 * 1000) - 1;
        return (globalFilter.fromMs === null || dayEndTs >= globalFilter.fromMs)
          && (globalFilter.toMs === null || dayTs <= globalFilter.toMs);
      });
    }

    function compareValues(a, b, dir) {
      if (typeof a === 'string' || typeof b === 'string') {
        const cmp = String(a).localeCompare(String(b));
        return dir === 'asc' ? cmp : -cmp;
      }
      const diff = Number(a) - Number(b);
      return dir === 'asc' ? diff : -diff;
    }

    function getTextFilter(id) {
      const el = document.getElementById(id);
      return (el && el.value ? el.value.trim().toLowerCase() : '');
    }

    function includesFilter(value, filter) {
      if (!filter) {
        return true;
      }
      return String(value).toLowerCase().includes(filter);
    }

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
        if (Number(s.avgLatencyMs) > 0) {
          item.latencies.push(Number(s.avgLatencyMs));
        }
        grouped.set(s.model, item);
      }

      const rows = Array.from(grouped.values());
      const totalCost = rows.reduce((sum, r) => sum + r.cost, 0);
      return rows.map(r => {
        const sorted = r.latencies.slice().sort((a, b) => a - b);
        const avgMs = sorted.length > 0 ? Math.round(sorted.reduce((sum, n) => sum + n, 0) / sorted.length) : 0;
        const tailMs = sorted.length > 0 ? sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)] : 0;
        return {
          model: r.model,
          turns: r.turns,
          cost: r.cost,
          credits: r.credits,
          pct: totalCost > 0 ? (r.cost / totalCost) * 100 : 0,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          cachedTokens: r.cachedTokens,
          totalTokens: r.totalTokens,
          cachePct: (r.inputTokens + r.cachedTokens) > 0 ? (r.cachedTokens / (r.inputTokens + r.cachedTokens)) * 100 : 0,
          avgMs,
          tailMs,
          tailLabel: sorted.length >= 20 ? 'P90' : sorted.length >= 5 ? 'P50' : '-',
        };
      });
    }

    function getRangePresetLabel() {
      if (globalFilter.preset === 'today') {
        return 'Today';
      }
      if (globalFilter.preset === '30d') {
        return 'Last 30 days';
      }
      if (globalFilter.preset === 'period') {
        return 'This period';
      }
      if (globalFilter.preset === '7d') {
        return 'Last 7 days';
      }
      return 'Custom range';
    }

    function setText(id, text) {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = text;
      }
    }

    function formatCompactNumber(value) {
      if (!Number.isFinite(value)) {
        return '0';
      }
      if (Math.abs(value) >= 1000000) {
        return (value / 1000000).toFixed(1) + 'M';
      }
      if (Math.abs(value) >= 1000) {
        return (value / 1000).toFixed(1) + 'K';
      }
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
      if (fill) {
        fill.style.width = Math.min(100, usagePct).toFixed(1) + '%';
        fill.style.background = usageColor;
      }

      const ordered = dailySeries.slice().sort((a, b) => String(a.period).localeCompare(String(b.period)));
      const labels = ordered.map(d => d.period);
      const costs = ordered.map(d => d.cost);
      const credits = ordered.map(d => d.credits);
      const tokenOrdered = insightDays.slice().sort((a, b) => String(a.period).localeCompare(String(b.period)));
      if (overviewChartMode === 'tokens') {
        dailyChartInst.data.labels = tokenOrdered.map(d => d.period);
        dailyChartInst.data.datasets = [
          {
            label: 'Cached Input',
            data: tokenOrdered.map(d => d.cached),
            borderColor: '#4fc3f7',
            backgroundColor: 'rgba(79,195,247,0.20)',
            fill: false,
            tension: 0.3,
            pointRadius: 2,
          },
          {
            label: 'Net Input',
            data: tokenOrdered.map(d => d.input),
            borderColor: '#81c784',
            backgroundColor: 'rgba(129,199,132,0.20)',
            fill: false,
            tension: 0.3,
            pointRadius: 2,
          },
          {
            label: 'Output',
            data: tokenOrdered.map(d => d.output),
            borderColor: '#ffb74d',
            backgroundColor: 'rgba(255,183,77,0.20)',
            fill: false,
            tension: 0.3,
            pointRadius: 2,
          }
        ];
      } else {
        dailyChartInst.data.labels = labels;
        dailyChartInst.data.datasets = [
          {
            label: 'Cost (USD)',
            data: costs,
            borderColor: '#4fc3f7',
            backgroundColor: 'rgba(79,195,247,0.08)',
            fill: true,
            tension: 0.3,
            pointRadius: 2,
          },
          {
            label: 'Credits',
            data: credits,
            borderColor: '#81c784',
            fill: false,
            tension: 0.3,
            pointRadius: 2,
            yAxisID: 'y2',
          }
        ];
      }
      dailyChartInst.update();

      setText('overviewChartTitle', (overviewChartMode === 'tokens' ? 'Tokens' : 'Cost & Credits') + ' — ' + presetLabel);
      setText('budgetModelTitle', 'Model Breakdown (' + presetLabel + ')');
    }

    function getFallbackModelRows() {
      return (modelDataByPeriod['7d'] || modelDataByPeriod['30d'] || []).map(r => ({
        ...r,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        totalTokens: 0,
        cachePct: 0,
      }));
    }

    function renderModels(rows) {
      const labels = rows.map(r => r.model);
      const costs  = rows.map(r => r.cost);
      const pcts   = rows.map(r => r.pct);
      const clrs   = colors.slice(0, Math.max(labels.length, 1));
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

    function normalizeAgentName(agentName) {
      if (!agentName || agentName === 'unknown') {
        return 'Unknown';
      }
      if (agentName === 'panel/editAgent') {
        return 'Inline Chat';
      }
      if (agentName === 'XtabProvider') {
        return 'Next Edit Suggestions';
      }
      if (agentName === 'GitHub Copilot Chat') {
        return 'Sidebar Chat';
      }
      if (agentName === 'summarizeConversationHistory') {
        return 'Context Summarization';
      }
      if (agentName === 'progressMessages') {
        return 'Background Processing';
      }
      if (agentName === 'title') {
        return 'Title Generation';
      }
      return agentName;
    }

    function getAgentRowsForRange() {
      const grouped = new Map();
      for (const row of agentDailyBreakdown) {
        const dayTs = new Date(row.period + 'T00:00:00').getTime();
        const dayEndTs = dayTs + (24 * 60 * 60 * 1000) - 1;
        if ((globalFilter.fromMs !== null && dayEndTs < globalFilter.fromMs)
          || (globalFilter.toMs !== null && dayTs > globalFilter.toMs)) {
          continue;
        }

        const key = row.agentName || 'unknown';
        const item = grouped.get(key) || {
          agentName: key,
          totalCostUsd: 0,
          totalCredits: 0,
          turnCount: 0,
          percentage: 0,
        };
        item.totalCostUsd += Number(row.totalCostUsd || 0);
        item.totalCredits += Number(row.totalCredits || 0);
        item.turnCount += Number(row.turnCount || 0);
        grouped.set(key, item);
      }

      const rows = Array.from(grouped.values()).sort((a, b) => b.totalCostUsd - a.totalCostUsd).slice(0, 12);
      const totalCost = rows.reduce((sum, r) => sum + r.totalCostUsd, 0);
      rows.forEach((r) => {
        r.percentage = totalCost > 0 ? (r.totalCostUsd / totalCost) * 100 : 0;
      });

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

    // Sessions table
    const sessionsBody = document.getElementById('sessionsBody');
    const sessionCountEl = document.getElementById('sessionCount');

    function renderSessions(filteredBase) {
      const dateFilter = getTextFilter('sessionsFilterDate');
      const modelFilter = getTextFilter('sessionsFilterModel');
      const turnsFilter = getTextFilter('sessionsFilterTurns');
      const costFilter = getTextFilter('sessionsFilterCost');
      const creditsFilter = getTextFilter('sessionsFilterCredits');
      const tokensFilter = getTextFilter('sessionsFilterTokens');
      const cachePctFilter = getTextFilter('sessionsFilterCachePct');
      const latencyFilter = getTextFilter('sessionsFilterLatency');

      const filtered = filteredBase.filter(s => {
        const cachePct = (Number(s.inputTokens || 0) + Number(s.cachedTokens || 0)) > 0
          ? (Number(s.cachedTokens || 0) / (Number(s.inputTokens || 0) + Number(s.cachedTokens || 0))) * 100
          : 0;
        return includesFilter(formatSessionDate(s.ts), dateFilter)
          && includesFilter(s.model, modelFilter)
          && includesFilter(s.turns, turnsFilter)
          && includesFilter(Number(s.costUsd).toFixed(3), costFilter)
          && includesFilter(Number(s.credits).toFixed(1), creditsFilter)
          && includesFilter(Number(s.totalTokens || 0), tokensFilter)
          && includesFilter(cachePct.toFixed(1), cachePctFilter)
          && includesFilter(s.avgLatencyMs, latencyFilter);
      }).sort((a, b) => compareValues(a[sessionsSort.key], b[sessionsSort.key], sessionsSort.dir));

      const visible = filtered.slice(0, MAX_SESSION_ROWS);
      sessionsBody.innerHTML = '';
      visible.forEach(s => {
        const tr = document.createElement('tr');
        appendCell(tr, formatSessionDate(s.ts));
        appendCell(tr, s.model);
        appendCell(tr, s.turns, 'num');
        appendCell(tr, '$' + Number(s.costUsd).toFixed(3), 'num');
        appendCell(tr, Number(s.credits).toFixed(1), 'num');
        appendCell(tr, formatCompactNumber(Number(s.totalTokens || 0)), 'num');
        const cachePct = (Number(s.inputTokens || 0) + Number(s.cachedTokens || 0)) > 0
          ? (Number(s.cachedTokens || 0) / (Number(s.inputTokens || 0) + Number(s.cachedTokens || 0))) * 100
          : 0;
        appendCell(tr, cachePct.toFixed(1) + '%', 'num');
        appendCell(tr, s.avgLatencyMs, 'num');
        sessionsBody.appendChild(tr);
      });
      const suffix = filtered.length > MAX_SESSION_ROWS ? ' (showing first ' + MAX_SESSION_ROWS + ')' : '';
      sessionCountEl.textContent = filtered.length + ' of ' + sessions.length + ' sessions' + suffix;
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

      const topModel = modelRows.reduce((top, row) => {
        if (!top || row.cost > top.cost) {
          return row;
        }
        return top;
      }, null);

      setText('tokensTotalInput', formatCompactNumber(billableInput));
      setText('tokensTotalInputSub', formatCompactNumber(totalInput) + ' net + ' + formatCompactNumber(totalCached) + ' cached');
      setText('tokensTotalCached', formatCompactNumber(totalCached));
      setText('tokensTotalCachedSub', 'cache hit ' + cacheHitPct.toFixed(1) + '%');
      setText('tokensTotalOutput', formatCompactNumber(totalOutput));
      setText('tokensTotalOutputSub', 'I:O ratio ' + (totalOutput > 0 ? ioRatio + ':1' : '—:1'));
      setText('tokensAvgPerTurn', formatCompactNumber(avgPerTurn));
      setText('tokensAvgPerTurnSub', totalTurns + ' turns in range');

      if (topModel) {
        setText('tokensTopModel', topModel.model);
        setText('tokensTopModelSub', '$' + topModel.cost.toFixed(2) + ' (' + topModel.pct.toFixed(1) + '%)');
      } else {
        setText('tokensTopModel', 'N/A');
        setText('tokensTopModelSub', '$0.00 (0.0%)');
      }
    }

    // Tokens table
    const tokensBody = document.getElementById('tokensBody');

    function renderTokens(modelRows) {
      const modelFilter = getTextFilter('tokensFilterModel');
      const turnsFilter = getTextFilter('tokensFilterTurns');
      const costFilter = getTextFilter('tokensFilterCost');
      const avgCostFilter = getTextFilter('tokensFilterAvgCost');
      const avgCreditsFilter = getTextFilter('tokensFilterAvgCredits');

      const rows = modelRows.map(r => {
        const avgCost = r.turns > 0 ? r.cost / r.turns : 0;
        const avgCredits = r.turns > 0 ? r.credits / r.turns : 0;
        const totalCostRounded = roundHalfUp(r.cost, 2);
        return {
          model: r.model,
          turns: r.turns,
          totalCost: r.cost,
          totalCostRounded,
          avgCost,
          avgCredits,
        };
      }).filter(r => {
        return includesFilter(r.model, modelFilter)
          && includesFilter(r.turns, turnsFilter)
          && includesFilter(r.totalCostRounded.toFixed(2), costFilter)
          && includesFilter(r.avgCost.toFixed(4), avgCostFilter)
          && includesFilter(r.avgCredits.toFixed(2), avgCreditsFilter);
      }).sort((a, b) => compareValues(a[tokensSort.key], b[tokensSort.key], tokensSort.dir));

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
      const modelFilter = getTextFilter('modelsFilterModel');
      const turnsFilter = getTextFilter('modelsFilterTurns');
      const costFilter = getTextFilter('modelsFilterCost');
      const pctFilter = getTextFilter('modelsFilterPct');
      const tokensFilter = getTextFilter('modelsFilterTokens');
      const cachePctFilter = getTextFilter('modelsFilterCachePct');
      const avgFilter = getTextFilter('modelsFilterAvg');
      const tailFilter = getTextFilter('modelsFilterTail');

      const rows = modelRows.filter(r => {
        return includesFilter(r.model, modelFilter)
          && includesFilter(r.turns, turnsFilter)
          && includesFilter(r.cost.toFixed(3), costFilter)
          && includesFilter(r.pct.toFixed(1), pctFilter)
          && includesFilter(r.totalTokens, tokensFilter)
          && includesFilter(r.cachePct.toFixed(1), cachePctFilter)
          && includesFilter(r.avgMs, avgFilter)
          && includesFilter(r.tailMs, tailFilter);
      }).sort((a, b) => compareValues(a[modelsSort.key], b[modelsSort.key], modelsSort.dir));

      renderModels(rows);
    }

    function bindSortHandlers(tabId, sortState, renderFn) {
      document.querySelectorAll('#' + tabId + ' th.sortable').forEach(th => {
        th.addEventListener('click', () => {
          const key = th.dataset.sort;
          if (!key) {
            return;
          }
          if (sortState.key === key) {
            sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
          } else {
            sortState.key = key;
            sortState.dir = 'desc';
          }
          renderFn();
        });
      });
    }

    function bindFilterInputs(ids, renderFn) {
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('input', renderFn);
        }
      });
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

      document.getElementById('globalRangeSummary').textContent = getRangeSummary(globalFilter.fromMs, globalFilter.toMs);
    }

    bindSortHandlers('tab-sessions', sessionsSort, rerenderAll);
    bindSortHandlers('tab-models', modelsSort, rerenderAll);
    bindSortHandlers('tab-tokens', tokensSort, rerenderAll);

    bindFilterInputs(['sessionsFilterDate', 'sessionsFilterModel', 'sessionsFilterTurns', 'sessionsFilterCost', 'sessionsFilterCredits', 'sessionsFilterTokens', 'sessionsFilterCachePct', 'sessionsFilterLatency'], rerenderAll);
    bindFilterInputs(['modelsFilterModel', 'modelsFilterTurns', 'modelsFilterCost', 'modelsFilterPct', 'modelsFilterTokens', 'modelsFilterCachePct', 'modelsFilterAvg', 'modelsFilterTail'], rerenderAll);
    bindFilterInputs(['tokensFilterModel', 'tokensFilterTurns', 'tokensFilterCost', 'tokensFilterAvgCost', 'tokensFilterAvgCredits'], rerenderAll);

    document.querySelectorAll('#overviewChartMode button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#overviewChartMode button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        overviewChartMode = btn.dataset.mode || 'cost';
        rerenderAll();
      });
    });

    document.querySelectorAll('.global-filter-bar .preset').forEach(btn => {
      btn.addEventListener('click', () => {
        applyPreset(btn.dataset.preset || 'period');
      });
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

    document.getElementById('globalReset').addEventListener('click', () => {
      applyPreset('period');
    });

    // Heatmap
    const heatmapData = ${heatmapData};
    const heatmapGrid = document.getElementById('heatmapGrid');
    const costColors = ['var(--border)', '#0e4429', '#006d32', '#26a641', '#39d353'];
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const CELL_STEP = 15; // 13px cell + 2px gap

    function renderHeatmap(mode) {
      const numWeeks = Math.ceil(heatmapData.length / 7);

      // Month labels row
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

      // Day labels — Mon, (blank), Wed, (blank), Fri, (blank), (blank)
      const dayLabelsEl = document.getElementById('heatmapDayLabels');
      dayLabelsEl.innerHTML = '';
      ['Mon', '', 'Wed', '', 'Fri', '', ''].forEach(name => {
        const span = document.createElement('span');
        span.className = 'heatmap-day-label';
        span.textContent = name;
        dayLabelsEl.appendChild(span);
      });

      // Grid
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

    // ── Insights tab charts ───────────────────────────────────────────────────
    const ioRatioLabels    = ${ioRatioLabels};
    const ioNetInputData   = ${ioNetInput};
    const ioCachedData     = ${ioCached};
    const ioOutputData     = ${ioOutput};

    const tokenTrendChartInst = new Chart(document.getElementById('tokenTrendChart'), {
      type: 'bar',
      data: {
        labels: ioRatioLabels,
        datasets: [
          { label: 'Cached Input', data: ioCachedData,   backgroundColor: 'rgba(79,195,247,0.55)',  stack: 'input' },
          { label: 'Net Input',    data: ioNetInputData,  backgroundColor: 'rgba(79,195,247,0.25)',  stack: 'input' },
          { label: 'Output',       data: ioOutputData,    backgroundColor: 'rgba(129,199,132,0.75)', stack: 'output' },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked: true, ticks: { color: textColor, maxTicksLimit: 8, font: { size: 10 } }, grid: { color: gridColor } },
          y: { stacked: false, ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor },
               title: { display: true, text: 'Tokens', color: textColor, font: { size: 10 } } }
        },
        plugins: { legend: { labels: { color: textColor, font: { size: 11 } } } }
      }
    });

    function getFilteredInsightDays() {
      const days = [];
      for (let i = 0; i < ioRatioLabels.length; i++) {
        const dayTs = new Date(ioRatioLabels[i] + 'T00:00:00').getTime();
        const dayEndTs = dayTs + (24 * 60 * 60 * 1000) - 1;
        if ((globalFilter.fromMs === null || dayEndTs >= globalFilter.fromMs)
          && (globalFilter.toMs === null || dayTs <= globalFilter.toMs)) {
          days.push({
            period: ioRatioLabels[i],
            input: Number(ioNetInputData[i] || 0),
            cached: Number(ioCachedData[i] || 0),
            output: Number(ioOutputData[i] || 0),
          });
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
      const avgStyle = avgInputPerTurn > 20 ? 'color:#e57373' : 'color:var(--fg)';
      const avgNote = avgInputPerTurn > 20
        ? 'High context load in this range'
        : 'within normal range';

      setText('insightCacheHitValue', cacheHitPct.toFixed(1) + '%');
      setText('insightCacheHitSub', (totalCached / 1000).toFixed(0) + 'K cached of ' + (totalBillableInput / 1000).toFixed(0) + 'K total input');
      const cacheHitValueEl = document.getElementById('insightCacheHitValue');
      if (cacheHitValueEl) {
        cacheHitValueEl.style.color = cacheColor;
      }
      const cacheHitFillEl = document.getElementById('insightCacheHitFill');
      if (cacheHitFillEl) {
        cacheHitFillEl.style.width = Math.min(100, cacheHitPct).toFixed(1) + '%';
        cacheHitFillEl.style.background = cacheColor;
      }

      setText('insightIoRatioValue', ioRatio);
      setText('insightIoRatioSub', (totalBillableInput / 1000).toFixed(0) + 'K in · ' + (totalOutput / 1000).toFixed(0) + 'K out');
      setText('insightAvgInputValue', avgInputPerTurn.toFixed(1) + 'K');
      setText('insightAvgInputSub', avgNote);
      const avgInputEl = document.getElementById('insightAvgInputValue');
      if (avgInputEl) {
        avgInputEl.style.cssText = avgStyle;
      }
      setText('insightTokenFlowTitle', 'Token Flow — ' + getRangePresetLabel() + ' (stacked)');

      tokenTrendChartInst.data.labels = insightDays.map(d => d.period);
      tokenTrendChartInst.data.datasets[0].data = insightDays.map(d => d.cached);
      tokenTrendChartInst.data.datasets[1].data = insightDays.map(d => d.input);
      tokenTrendChartInst.data.datasets[2].data = insightDays.map(d => d.output);
      tokenTrendChartInst.update();

      const rangeAlerts = [];
      if (cacheHitPct < 40 && totalBillableInput > 5000) {
        rangeAlerts.push('Low cache reuse in this range. Keep related tasks in one session to improve hit rate.');
      }
      if (avgInputPerTurn > 20) {
        rangeAlerts.push('High input per turn. Reduce attached context and split very broad prompts.');
      }
      if (totalOutput > 0 && (totalBillableInput / Math.max(1, totalOutput)) > 8) {
        rangeAlerts.push('High input-to-output ratio. Consider tighter prompts and smaller context windows.');
      }
      const alertsContainer = document.getElementById('insightsRangeAlerts');
      if (alertsContainer) {
        if (rangeAlerts.length === 0) {
          alertsContainer.innerHTML = '<div style="padding:8px 10px;border:1px solid var(--border);border-radius:4px;background:var(--card-bg);font-size:12px;color:var(--muted)">No range-specific token concerns detected.</div>';
        } else {
          alertsContainer.innerHTML = rangeAlerts.map((msg, idx) =>
            '<div style="padding:8px 10px;border:1px solid var(--border);border-left:3px solid #ffb74d;border-radius:4px;background:var(--card-bg);font-size:12px;margin-bottom:6px">' +
              '<strong>Token Alert ' + (idx + 1) + ':</strong> ' + msg +
            '</div>'
          ).join('');
        }
      }
    }

    const surfaceLabels = ${surfaceLabels};
    const surfaceInputs = ${surfaceInputs};
    if (surfaceLabels.length > 0) {
      new Chart(document.getElementById('surfacePieChart'), {
        type: 'doughnut',
        data: {
          labels: surfaceLabels,
          datasets: [{ data: surfaceInputs, backgroundColor: colors.slice(0, surfaceLabels.length) }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: textColor, font: { size: 11 } }, position: 'right' } }
        }
      });
    }

    renderAgentsForRange();
    applyPreset('period');
  </script>
</body>
</html>`;
  }

  private computeModelLatencyRows(days: number = 30): Array<{ model: string; avgMs: number; tailMs: number; tailLabel: string; tailHint: string }> {
    const samples = this.database.getModelLatencySamples(days);
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
        rows.push({
          model,
          avgMs,
          tailMs: 0,
          tailLabel: "-",
          tailHint: "Tail metric hidden: requires at least 5 turns.",
        });
        continue;
      }

      if (values.length < 20) {
        rows.push({
          model,
          avgMs,
          tailMs: this.percentile(values, 0.5),
          tailLabel: "P50",
          tailHint: "P50 (median) shown due to low sample size (<20 turns).",
        });
        continue;
      }

      rows.push({
        model,
        avgMs,
        tailMs: this.percentile(values, 0.9),
        tailLabel: "P90",
        tailHint: "P90 shown (sample size >=20 turns).",
      });
    }

    return rows;
  }

  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) {
      return 0;
    }

    const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(p * sortedValues.length) - 1));
    return Math.round(sortedValues[idx]);
  }

  private getUsagePresentation(periodCredits: number, budgetCredits: number): { usagePct: string } {
    const usagePct = budgetCredits > 0
      ? ((periodCredits / budgetCredits) * 100).toFixed(1)
      : "0";
    return { usagePct };
  }

  private getBudgetDetails(
    periodStartMs: number,
    periodEndMs: number,
    periodTurns: number,
    periodCredits: number,
    budgetCredits: number
  ): {
    daysRemaining: number;
    dailyBudgetRemaining: string;
    burnRate: number;
    projectedPeriodCredits: number;
    forecastVisible: boolean;
    forecastOverage: number;
  } {
    const daysRemaining = Math.max(0, Math.ceil((periodEndMs - Date.now()) / (24 * 60 * 60 * 1000)));
    const dailyBudgetRemaining = daysRemaining > 0
      ? ((budgetCredits - periodCredits) / daysRemaining).toFixed(1)
      : "0";

    const msInDay = 24 * 60 * 60 * 1000;
    const totalDaysInPeriod = Math.max(1, Math.ceil((periodEndMs - periodStartMs) / msInDay));
    const daysSincePeriodStart = Math.max(1, Math.ceil((Date.now() - periodStartMs) / msInDay));
    const burnRate = periodCredits / daysSincePeriodStart;
    const projectedPeriodCredits = burnRate * totalDaysInPeriod;
    const forecastVisible = periodTurns >= 50 || periodCredits >= 0.5;
    const forecastOverage = projectedPeriodCredits - budgetCredits;

    return {
      daysRemaining,
      dailyBudgetRemaining,
      burnRate,
      projectedPeriodCredits,
      forecastVisible,
      forecastOverage,
    };
  }

  private buildInsightViewData(insightMetrics: InsightMetrics): { totalBillableInput30d: number; avgInputPerTurn: number } {
    const totalBillableInput30d = insightMetrics.totalInputTokens + insightMetrics.totalCachedTokens;
    const avgInputPerTurn = insightMetrics.totalTurns > 0
      ? Math.round(totalBillableInput30d / insightMetrics.totalTurns / 100) / 10
      : 0;
    return { totalBillableInput30d, avgInputPerTurn };
  }

  private buildEstimateData(insightMetrics: InsightMetrics, monthCostUsd: number): {
    estHoursSaved: string;
    costPerOutputK: string;
    outputTokensK: string;
    inputOverheadPct: string;
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

    return {
      estHoursSaved,
      costPerOutputK,
      outputTokensK,
      inputOverheadPct,
    };
  }

  private getInsightStyles(insightMetrics: InsightMetrics, totalBillableInput30d: number, avgInputPerTurn: number): {
    cacheHitColor: string;
    avgInputStyle: string;
    avgInputNote: string;
    errorStyle: string;
    errorNote: string;
    ioRatioLabel: string;
  } {
    let cacheHitColor = "#e57373";
    if (insightMetrics.cacheHitPct >= 70) {
      cacheHitColor = "#81c784";
    } else if (insightMetrics.cacheHitPct >= 40) {
      cacheHitColor = "#ffb74d";
    }

    const avgInputStyle = avgInputPerTurn > 20 ? "color:#e57373" : "";
    const avgInputNote = avgInputPerTurn > 20
      ? "⚠ Context bloat — consider reducing attached files"
      : "within normal range";

    const errorStyle = insightMetrics.errorTurns > 0 ? "color:#e57373" : "";
    const errorNote = insightMetrics.totalTurns > 0
      ? `${((insightMetrics.errorTurns / insightMetrics.totalTurns) * 100).toFixed(1)}% of total turns`
      : "no data";

    const ioRatioLabel = insightMetrics.totalOutputTokens > 0
      ? `${Math.round(totalBillableInput30d / insightMetrics.totalOutputTokens)}:1`
      : "—:1";

    return { cacheHitColor, avgInputStyle, avgInputNote, errorStyle, errorNote, ioRatioLabel };
  }

  private getMeaningfulSurfaces(surfaceData: SurfaceBreakdown[]): SurfaceBreakdown[] {
    const skipSurfaces = new Set(["Background Processing", "Title Generation"]);
    return surfaceData.filter((surface) => surface.inputTokens > 0 && !skipSurfaces.has(surface.label));
  }

  private getSurfacePieHtml(hasData: boolean): string {
    if (hasData) {
      return '<canvas id="surfacePieChart"></canvas>';
    }
    return '<span style="color:var(--muted);font-size:12px">No surface data available.<br>Requires agent-traces.db (VS Code Copilot extension).</span>';
  }

  private buildAlertCardsHtml(alerts: DashboardAlert[]): string {
    if (alerts.length === 0) {
      return `<div style="padding:10px 12px;background:var(--card-bg);border:1px solid var(--border);border-radius:4px;font-size:12px;color:var(--muted)">
           ✅ No active alerts — your token usage habits look efficient today.
         </div>`;
    }

    const severityColors: Record<string, string> = {
      info: "#4fc3f7",
      warning: "#ffb74d",
      critical: "#e57373",
    };

    return alerts.map((alert) => {
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
    }).join("\n");
  }

  private buildModelPeriodData(days: number): Array<{ model: string; cost: number; credits: number; turns: number; pct: number; avgMs: number; tailMs: number; tailLabel: string }> {
    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const breakdown = this.database.getModelBreakdownSince(sinceMs);
    const latencyRows = this.computeModelLatencyRows(days);
    const latencyMap = new Map(latencyRows.map(r => [r.model, r]));
    return breakdown.map(m => {
      const lat = latencyMap.get(m.model) ?? { avgMs: 0, tailMs: 0, tailLabel: "-" };
      return { model: m.model, cost: m.totalCostUsd, credits: m.totalCredits, turns: m.turnCount, pct: m.percentage, avgMs: lat.avgMs, tailMs: lat.tailMs, tailLabel: lat.tailLabel };
    });
  }

  private buildHeatmapData(dailyCosts: Array<{ period: string; totalCostUsd: number; turnCount: number }>): string {
    // Build 52 weeks (364 days) of data, aligned to Monday (GitHub-style)
    const now = new Date();
    const days: Array<{ date: string; cost: number; turns: number }> = [];

    // Find the most recent Monday
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    // Go back 52 weeks from this Monday
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset - (51 * 7));

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

  private getBudgetColor(percentage: number): string {
    if (percentage > 90) {
      return "var(--vscode-errorForeground)";
    } else if (percentage > 75) {
      return "var(--vscode-editorWarning-foreground)";
    }
    return "var(--accent)";
  }

  private getForecastHtml(
    forecastVisible: boolean,
    projectedCredits: number,
    burnRate: number,
    overage: number
  ): string {
    if (!forecastVisible) {
      return `
        <div class="stat-value">-</div>
        <div class="stat-sub">Forecast beschikbaar zodra er meer verbruiksdata is</div>
        <div class="stat-sub">(>= 50 turns of >= 0.50 credits)</div>
      `;
    }

    const overageHtml =
      overage > 0
        ? `<div class="stat-sub" style="color:var(--vscode-errorForeground)">+${overage.toFixed(1)} cr boven budget</div>`
        : `<div class="stat-sub">${Math.abs(overage).toFixed(1)} cr onder budget</div>`;

    return `
      <div class="stat-value">${projectedCredits.toFixed(1)} cr</div>
      <div class="stat-sub">Burn rate: ${burnRate.toFixed(2)} cr/day</div>
      ${overageHtml}
    `;
  }

  private createNonce(length: number = 32): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let i = 0; i < length; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }

  private dispose(): void {
    DashboardPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
