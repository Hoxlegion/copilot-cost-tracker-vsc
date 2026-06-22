<script lang="ts">
  import { dashboardData, formatUsd } from '../../stores/dashboard';
  import { filteredSessions } from '../../stores/filteredSessions';
  import BudgetBar from '../shared/BudgetBar.svelte';
  import DailyChart from '../charts/DailyChart.svelte';
  import { formatCompactNumber } from '../../utils/format';
  
  $: data = $dashboardData;
  $: budgetCredits = data?.budgetCredits ?? 0;
  $: periodCredits = data?.periodCredits ?? 0;
  $: periodCost = data?.periodAggregate?.costUsd ?? 0;
  $: billingPeriodStartMs = data?.billingPeriodStartMs ?? 0;
  $: billingPeriodEndMs = data?.billingPeriodEndMs ?? 0;
  $: sessions = $filteredSessions;
  
  $: msInDay = 86400000;
  $: daysRemaining = Math.max(0, Math.ceil((billingPeriodEndMs - Date.now()) / msInDay));
  $: totalDaysInPeriod = Math.max(1, Math.ceil((billingPeriodEndMs - billingPeriodStartMs) / msInDay));
  $: daysSincePeriodStart = Math.max(1, Math.ceil((Date.now() - billingPeriodStartMs) / msInDay));
  $: burnRate = daysSincePeriodStart > 0 ? periodCredits / daysSincePeriodStart : 0;
  $: projectedPeriodCredits = burnRate * totalDaysInPeriod;
  $: dailyBudget = budgetCredits > 0 ? budgetCredits / totalDaysInPeriod : 0;
  
  $: usagePct = budgetCredits > 0 ? ((periodCredits / budgetCredits) * 100) : 0;
  $: usageColor = usagePct >= 100 ? '#e57373' : usagePct >= 80 ? '#ffb74d' : '#81c784';
  $: remainingCredits = budgetCredits - periodCredits;
  
  $: forecastOverage = projectedPeriodCredits - budgetCredits;
  $: forecastOverPct = budgetCredits > 0 ? ((forecastOverage / budgetCredits) * 100) : 0;
  
  $: pacingStatus = (() => {
    if (budgetCredits <= 0) return { label: 'No budget set', color: '#4fc3f7', icon: '📊' };
    if (burnRate > dailyBudget * 1.3) return { label: 'Over pace', color: '#e57373', icon: '🔴' };
    if (burnRate > dailyBudget * 0.9) return { label: 'Tight', color: '#ffb74d', icon: '🟡' };
    return { label: 'On track', color: '#81c784', icon: '🟢' };
  })();
  
  // Progress position (how far through the period)
  $: periodProgressPct = totalDaysInPeriod > 0 ? (daysSincePeriodStart / totalDaysInPeriod) * 100 : 0;
  $: forecastEndPct = budgetCredits > 0 ? Math.min(150, (projectedPeriodCredits / budgetCredits) * 100) : 0;
  
  // Daily breakdown for budget view
  $: dailyCosts = data?.dailyCosts ?? [];
</script>

<div class="budget-tab">
  {#if budgetCredits <= 0}
    <div class="no-budget">
      <div class="no-budget-icon">📊</div>
      <h3>No Budget Configured</h3>
      <p>Set a credit budget in settings to enable budget tracking, pacing analysis, and forecasting.</p>
      <p class="no-budget-hint">Setting: <code>copilotCostTracker.budgetCredits</code></p>
      <div class="period-summary">
        <div class="ps-item">
          <span class="ps-label">Period Spend</span>
          <span class="ps-value">{$formatUsd(periodCost)}</span>
        </div>
        <div class="ps-item">
          <span class="ps-label">Credits Used</span>
          <span class="ps-value">{formatCompactNumber(periodCredits)} cr</span>
        </div>
        <div class="ps-item">
          <span class="ps-label">Days Remaining</span>
          <span class="ps-value">{daysRemaining}</span>
        </div>
        <div class="ps-item">
          <span class="ps-label">Burn Rate</span>
          <span class="ps-value">{formatCompactNumber(burnRate)} cr/day</span>
        </div>
      </div>
    </div>
  {:else}
    <!-- Budget gauge -->
    <div class="gauge-section">
      <div class="gauge-visual">
        <div class="gauge-ring">
          <svg viewBox="0 0 120 120" class="gauge-svg">
            <circle cx="60" cy="60" r="52" fill="none" stroke="var(--vscode-panel-border)" stroke-width="8" stroke-dasharray="326.73" stroke-dashoffset="0" transform="rotate(-90, 60, 60)" />
            <circle cx="60" cy="60" r="52" fill="none" stroke={usageColor} stroke-width="8" stroke-linecap="round"
              stroke-dasharray="326.73" 
              stroke-dashoffset={326.73 * (1 - Math.min(1, usagePct / 100))}
              transform="rotate(-90, 60, 60)"
              style="transition: stroke-dashoffset 0.5s ease" />
          </svg>
          <div class="gauge-center">
            <span class="gauge-pct" style="color: {usageColor}">{usagePct.toFixed(0)}%</span>
            <span class="gauge-label">used</span>
          </div>
        </div>
        <div class="gauge-details">
          <div class="gd-row">
            <span class="gd-label">Used</span>
            <span class="gd-value">{formatCompactNumber(periodCredits)} cr · {$formatUsd(periodCost)}</span>
          </div>
          <div class="gd-row">
            <span class="gd-label">{remainingCredits >= 0 ? 'Remaining' : 'Over budget'}</span>
            <span class="gd-value" style="color: {remainingCredits >= 0 ? '#81c784' : '#e57373'}">{formatCompactNumber(Math.abs(remainingCredits))} cr</span>
          </div>
          <div class="gd-row">
            <span class="gd-label">Budget</span>
            <span class="gd-value">{formatCompactNumber(budgetCredits)} cr</span>
          </div>
          <div class="gd-row">
            <span class="gd-label">Days Left</span>
            <span class="gd-value">{daysRemaining} of {totalDaysInPeriod}</span>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Pacing -->
    <div class="pacing-section">
      <h3>Pacing</h3>
      <div class="pacing-stats">
        <div class="pace-item">
          <span class="pace-icon">{pacingStatus.icon}</span>
          <span class="pace-label" style="color: {pacingStatus.color}">{pacingStatus.label}</span>
        </div>
        <div class="pace-detail">
          <span>Burn rate: <strong>{formatCompactNumber(burnRate)} cr/day</strong></span>
          <span class="pace-sep">·</span>
          <span>Budget allows: <strong>{formatCompactNumber(dailyBudget)} cr/day</strong></span>
        </div>
        <div class="pace-detail">
          <span>Forecast: <strong style="color: {forecastOverage > 0 ? '#e57373' : '#81c784'}">{formatCompactNumber(projectedPeriodCredits)} cr</strong></span>
          {#if forecastOverage > 0}
            <span class="pace-sep">·</span>
            <span style="color: #e57373">▲ {forecastOverPct.toFixed(0)}% over budget</span>
          {:else}
            <span class="pace-sep">·</span>
            <span style="color: #81c784">{Math.abs(forecastOverPct).toFixed(0)}% under budget</span>
          {/if}
        </div>
      </div>
      
      <!-- Timeline bar -->
      <div class="timeline">
        <div class="timeline-track">
          <div class="timeline-progress" style="width: {Math.min(100, periodProgressPct)}%"></div>
          <div class="timeline-marker today-marker" style="left: {Math.min(100, periodProgressPct)}%">
            <span class="marker-label">Today</span>
          </div>
        </div>
        <div class="timeline-labels">
          <span>Start</span>
          <span>End</span>
        </div>
      </div>
    </div>
    
    <!-- Daily chart -->
    <div class="daily-section">
      <h3>Daily Spend</h3>
      <DailyChart />
    </div>
  {/if}
</div>

<style>
  .budget-tab { padding: 0; }
  
  /* ── No budget ── */
  .no-budget {
    text-align: center;
    padding: 30px 20px;
    background: color-mix(in srgb, var(--vscode-editorWidget-background) 78%, #103449 22%);
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, #2aa5ff 30%);
    border-radius: 12px;
  }
  .no-budget-icon { font-size: 40px; margin-bottom: 12px; }
  .no-budget h3 { margin: 0 0 8px; font-size: 16px; }
  .no-budget p { margin: 0 0 6px; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .no-budget-hint { margin-top: 12px !important; }
  .no-budget code {
    background: var(--vscode-textBlockQuote-background);
    padding: 2px 6px; border-radius: 3px;
    font-family: var(--vscode-editor-font-family); font-size: 11px;
  }
  .period-summary {
    display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
    margin-top: 20px; text-align: left;
  }
  .ps-item {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 8px; padding: 10px 14px;
  }
  .ps-label { font-size: 11px; color: var(--vscode-descriptionForeground); text-transform: uppercase; display: block; }
  .ps-value { font-size: 18px; font-weight: 700; display: block; margin-top: 2px; }
  
  /* ── Gauge ── */
  .gauge-section {
    background: color-mix(in srgb, var(--vscode-editorWidget-background) 72%, #103449 28%);
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, #2aa5ff 40%);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 14px;
  }
  .gauge-visual { display: flex; align-items: center; gap: 30px; }
  .gauge-ring { position: relative; width: 120px; height: 120px; flex-shrink: 0; }
  .gauge-svg { width: 100%; height: 100%; }
  .gauge-center {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    text-align: center;
  }
  .gauge-pct { font-size: 22px; font-weight: 800; display: block; }
  .gauge-label { font-size: 10px; color: var(--vscode-descriptionForeground); text-transform: uppercase; }
  .gauge-details { flex: 1; display: flex; flex-direction: column; gap: 8px; }
  .gd-row { display: flex; justify-content: space-between; font-size: 13px; }
  .gd-label { color: var(--vscode-descriptionForeground); }
  .gd-value { font-weight: 600; }
  
  /* ── Pacing ── */
  .pacing-section {
    background: color-mix(in srgb, var(--vscode-editorWidget-background) 78%, #103449 22%);
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, #2aa5ff 30%);
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 14px;
  }
  .pacing-section h3 {
    margin: 0 0 10px; font-size: 13px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.3px;
  }
  .pacing-stats { display: flex; flex-direction: column; gap: 6px; }
  .pace-item { display: flex; align-items: center; gap: 8px; }
  .pace-icon { font-size: 18px; }
  .pace-label { font-size: 14px; font-weight: 700; }
  .pace-detail { font-size: 12px; color: var(--vscode-descriptionForeground); }
  .pace-detail strong { color: var(--vscode-editor-foreground); }
  .pace-sep { opacity: 0.3; margin: 0 4px; }
  
  /* Timeline */
  .timeline { margin-top: 14px; }
  .timeline-track {
    position: relative; height: 6px;
    background: var(--vscode-panel-border); border-radius: 3px;
  }
  .timeline-progress {
    height: 100%; border-radius: 3px;
    background: linear-gradient(90deg, #4fc3f7, #81c784);
    transition: width 0.3s ease;
  }
  .timeline-marker {
    position: absolute; top: -6px;
    transform: translateX(-50%);
  }
  .today-marker::before {
    content: '';
    display: block;
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--vscode-editor-foreground);
    border: 2px solid var(--vscode-editor-background);
    margin: 0 auto 2px;
  }
  .marker-label {
    font-size: 9px; text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
  }
  .timeline-labels {
    display: flex; justify-content: space-between;
    font-size: 10px; color: var(--vscode-descriptionForeground);
    margin-top: 6px;
  }
  
  /* ── Daily chart ── */
  .daily-section h3 {
    margin: 0 0 10px; font-size: 13px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.3px;
  }
</style>
