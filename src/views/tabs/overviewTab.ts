import type { DashboardViewData } from "./index";

export function renderOverviewTab(v: DashboardViewData): string {
  return `
  <div class="tab-content active" id="tab-overview">
    <div class="stat-row">
      <div class="stat">
        <div class="stat-label" id="overviewRangeCostLabel">Range Cost</div>
        <div class="stat-value" id="overviewRangeCost">$${v.today.costUsd.toFixed(2)}</div>
        <div class="stat-sub" id="overviewRangeCostSub">${v.today.credits.toFixed(0)} cr · ${v.today.turns} turns</div>
      </div>
      <div class="stat">
        <div class="stat-label">Range Credits</div>
        <div class="stat-value" id="overviewRangeCredits">${v.week.credits.toFixed(0)} cr</div>
        <div class="stat-sub" id="overviewRangeCreditsSub">$${v.week.costUsd.toFixed(2)} · ${v.week.turns} turns</div>
      </div>
      <div class="stat">
        <div class="stat-label">Range Turns</div>
        <div class="stat-value" id="overviewRangeTurns">${v.monthTotal.turns}</div>
        <div class="stat-sub" id="overviewRangeTurnsSub">$${v.monthTotal.costUsd.toFixed(2)} · ${v.monthTotal.credits.toFixed(0)} cr</div>
      </div>
      <div class="stat">
        <div class="stat-label">Budget Used (Period)</div>
        <div class="stat-value">${v.usagePct}%</div>
        <div class="stat-sub">${v.periodCredits.toFixed(0)} / ${v.budgetCredits} cr</div>
        <div class="budget-bar"><div class="budget-fill" style="width:${Math.min(100, Number.parseFloat(v.usagePct))}%"></div></div>
      </div>
      <div class="stat">
        <div class="stat-label">Chat Sessions</div>
        <div class="stat-value" id="overviewSessionCount">${v.sessionCount}</div>
        <div class="stat-sub" id="overviewSessionCountSub">current range</div>
      </div>
      <div class="stat">
        <div class="stat-label">Top Workspace (Range)</div>
        <div class="stat-value" style="font-size:15px;line-height:1.2">${v.workspaceSummaryView.topWorkspaceLabel}</div>
        <div class="stat-sub">$${v.workspaceSummaryView.topWorkspaceCostUsd.toFixed(2)} · ${v.workspaceSummaryView.topWorkspaceSessions} sessions</div>
      </div>
      <div class="stat">
        <div class="stat-label">LLM Calls</div>
        <div class="stat-value" id="overviewCallCount">${v.monthTotal.turns}</div>
        <div class="stat-sub" id="overviewCallCountSub">turns in range</div>
      </div>
      <div class="stat">
        <div class="stat-label">Avg Response</div>
        <div class="stat-value">${v.avgResponseLabel}</div>
        <div class="stat-sub">last 30 days</div>
      </div>
      <div class="stat">
        <div class="stat-label">Cache Savings (Period)</div>
        <div class="stat-value" style="color:${v.cacheSavingsView.hasSavings ? 'var(--vscode-charts-green, #4caf50)' : 'var(--muted)'}">${v.cacheSavingsView.hasSavings ? '$' + v.cacheSavingsView.savingsCostUsd : '—'}</div>
        <div class="stat-sub">${v.cacheSavingsView.hasSavings ? v.cacheSavingsView.savingsCredits + ' cr · ' + v.cacheSavingsView.savingsPct + '% of spend' : 'No cache data this period'}</div>
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
            <h3>Credits (CR)</h3>
            <p><strong>1 Credit = $0.01 USD</strong></p>
            <p>Credits represent the monetary cost of using GitHub Copilot. The amount of credits used depends on the number of tokens consumed by your queries and the model you're using.</p>
          </div>
          <div class="help-section">
            <h3>Tokens</h3>
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
            <h3>Cost Calculation</h3>
            <p>Cost is calculated as: <code>(Tokens / 1,000,000) x Price per Million Tokens</code></p>
            <p>Different models have different pricing. For example:</p>
            <ul>
              <li>GPT-5 Mini: $0.25 per 1M input tokens</li>
              <li>Claude Haiku: $1 per 1M input tokens</li>
              <li>Gemini 3.5 Flash: $1.50 per 1M input tokens</li>
            </ul>
          </div>
          <div class="help-section">
            <h3>Budget Tracking</h3>
            <p>Your budget is set in the extension settings and represents your spending limit for the billing period. The dashboard tracks your usage against this budget.</p>
            <ul>
              <li><strong>Budget Used %:</strong> Percentage of your budget consumed</li>
              <li><strong>Days Remaining:</strong> Days left in the current billing period</li>
              <li><strong>Daily Budget:</strong> Average credits you can spend per remaining day</li>
            </ul>
          </div>
          <div class="help-section">
            <h3>Billing Period</h3>
            <p>The billing period is determined by your configured billing cycle start day (default: 1st of the month). All costs are grouped by this period for budget tracking and analysis.</p>
          </div>
        </div>
      </div>
    </div>

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
  </div>`;
}
