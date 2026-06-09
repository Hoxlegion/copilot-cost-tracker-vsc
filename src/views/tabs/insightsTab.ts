import type { DashboardViewData } from "./index";

export function renderInsightsTab(v: DashboardViewData): string {
  const cacheHitQuality = v.insightMetrics.cacheHitPct >= 70
    ? 'Excellent'
    : v.insightMetrics.cacheHitPct >= 40
      ? 'Moderate — reuse files across sessions'
      : 'Low — avoid large one-off pastes';
  return `
  <div class="tab-content" id="tab-insights">
    <div class="chart-section-title" style="margin-bottom:8px">Token Savings Playbook — Today</div>
    <div style="margin-bottom:16px">${v.alertCardsHtml}</div>
    <table style="margin-bottom:20px">
      <thead><tr><th>Strategy</th><th>Status</th><th>Your Metric</th><th>Impact</th></tr></thead>
      <tbody>${v.playbookRowsHtml}</tbody>
    </table>
    <div id="insightsRangeAlerts" style="margin:0 0 16px 0"></div>
    <div style="border-top:1px solid var(--border);padding-top:16px">
      <div class="stat-row">
        <div class="stat">
          <div class="stat-label">Cache Hit Rate (Range)</div>
          <div class="stat-value" id="insightCacheHitValue" style="color:${v.cacheHitColor}">${v.insightMetrics.cacheHitPct.toFixed(1)}%</div>
          <div class="stat-sub" id="insightCacheHitSub">${(v.insightMetrics.totalCachedTokens / 1000).toFixed(0)}K cached of ${((v.insightMetrics.totalInputTokens + v.insightMetrics.totalCachedTokens) / 1000).toFixed(0)}K total input · ${cacheHitQuality}</div>
          <div class="budget-bar"><div class="budget-fill" id="insightCacheHitFill" style="width:${Math.min(100, v.insightMetrics.cacheHitPct)}%;background:${v.cacheHitColor}"></div></div>
        </div>
        <div class="stat">
          <div class="stat-label">Input:Output Ratio (Range)</div>
          <div class="stat-value" id="insightIoRatioValue">${v.ioRatioLabel}</div>
          <div class="stat-sub" id="insightIoRatioSub">${(v.totalBillableInput30d / 1000).toFixed(0)}K in · ${(v.insightMetrics.totalOutputTokens / 1000).toFixed(0)}K out</div>
        </div>
        <div class="stat">
          <div class="stat-label">Avg Input / Turn (Range)</div>
          <div class="stat-value" id="insightAvgInputValue" style="${v.avgInputStyle}">${v.avgInputPerTurn}K</div>
          <div class="stat-sub" id="insightAvgInputSub">${v.avgInputNote}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Error Turns (30d)</div>
          <div class="stat-value" style="${v.errorStyle}">${v.insightMetrics.errorTurns}</div>
          <div class="stat-sub">${v.errorNote}</div>
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
            ${v.surfaceCostView.length > 0 ? '<canvas id="surfaceCostPieChart"></canvas>' : '<span style="color:var(--muted);font-size:12px">No data yet</span>'}
          </div>
        </div>
      </div>
      ${v.surfaceCostView.length > 0 ? `
      <div style="margin-top:4px">
        <div class="chart-section-title" style="margin-bottom:6px">Action Type Breakdown (30d)</div>
        <table style="font-size:12px">
          <thead><tr><th>Surface</th><th class="num">%</th><th class="num">Cost</th><th class="num">Credits</th><th class="num" style="color:var(--muted)">Turns</th></tr></thead>
          <tbody>${v.surfaceCostTableHtml}</tbody>
        </table>
      </div>` : ''}
      ${v.cacheSavingsView.hasSavings ? `
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:8px">
          <div class="chart-section-title" style="margin-bottom:0">Cache Savings (Period)</div>
          <span style="font-size:18px;font-weight:700;color:var(--vscode-charts-green,#4caf50)">$${v.cacheSavingsView.savingsCostUsd}</span>
          <span style="font-size:11px;color:var(--muted)">${v.cacheSavingsView.savingsCredits} cr · ${v.cacheSavingsView.savingsPct}% of period spend</span>
        </div>
        <table style="font-size:12px">
          <thead><tr><th>Model</th><th class="num">%</th><th class="num" style="color:var(--vscode-charts-green,#4caf50)">Saved</th></tr></thead>
          <tbody>${v.cacheSavingsView.topModelRows}</tbody>
        </table>
      </div>` : ''}
    </div>
  </div>`;
}
