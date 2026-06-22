<script lang="ts">
  import { dashboardData, formatUsd } from '../../stores/dashboard';
  import { filteredSessions } from '../../stores/filteredSessions';
  import StatCard from '../shared/StatCard.svelte';
  import BudgetBar from '../shared/BudgetBar.svelte';
  import DailyChart from '../charts/DailyChart.svelte';
  import HelpModal from '../shared/HelpModal.svelte';
  import { formatCompactNumber } from '../../utils/format';
  
  let showHelpModal = false;
  
  $: data = $dashboardData;
  $: budgetCredits = data?.budgetCredits ?? 0;
  $: periodCredits = data?.periodCredits ?? 0;
  $: billingPeriodStartMs = data?.billingPeriodStartMs ?? 0;
  $: billingPeriodEndMs = data?.billingPeriodEndMs ?? 0;
  $: allSessions = data?.allSessions ?? [];
  $: alerts = data?.alerts ?? [];
  $: sessions = $filteredSessions;
  
  // ── Hero stats ──
  $: rangeCost = sessions.reduce((sum, s) => sum + s.totalCostUsd, 0);
  $: rangeCredits = sessions.reduce((sum, s) => sum + s.totalCredits, 0);
  $: rangeTurns = sessions.reduce((sum, s) => sum + s.turnCount, 0);
  
  // Today stats  
  $: todayStart = (() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  })();
  $: todaySessions = allSessions.filter(s => s.startTimestamp >= todayStart);
  $: todayCost = todaySessions.reduce((sum, s) => sum + s.totalCostUsd, 0);
  $: todayCredits = todaySessions.reduce((sum, s) => sum + s.totalCredits, 0);
  $: todayTurns = todaySessions.reduce((sum, s) => sum + s.turnCount, 0);

  // Yesterday comparison
  $: yesterdayStart = todayStart - 86400000;
  $: yesterdaySessions = allSessions.filter(s => s.startTimestamp >= yesterdayStart && s.startTimestamp < todayStart);
  $: yesterdayCost = yesterdaySessions.reduce((sum, s) => sum + s.totalCostUsd, 0);
  $: todayVsYesterday = yesterdayCost > 0 ? ((todayCost - yesterdayCost) / yesterdayCost * 100) : 0;
  $: todayCompareLabel = (() => {
    if (yesterdayCost === 0 && todayCost === 0) return '';
    if (yesterdayCost === 0) return 'No activity yesterday';
    const pct = Math.abs(todayVsYesterday);
    const dir = todayVsYesterday >= 0 ? '↑' : '↓';
    return `${dir} ${pct.toFixed(0)}% vs yesterday`;
  })();
  
  // Period stats
  $: periodCost = data?.periodAggregate?.costUsd ?? 0;
  $: periodTurns = data?.periodAggregate?.turns ?? 0;
  $: daysRemaining = Math.max(0, Math.ceil((billingPeriodEndMs - Date.now()) / 86400000));
  $: msInDay = 86400000;
  $: totalDaysInPeriod = Math.max(1, Math.ceil((billingPeriodEndMs - billingPeriodStartMs) / msInDay));
  $: daysSincePeriodStart = Math.max(1, Math.ceil((Date.now() - billingPeriodStartMs) / msInDay));
  $: burnRate = daysSincePeriodStart > 0 ? periodCredits / daysSincePeriodStart : 0;
  $: projectedPeriodCredits = burnRate * totalDaysInPeriod;

  // Secondary stats
  $: cacheSavingsValue = (() => {
    // Use the real per-cached-token savings (input rate − cached rate) measured from
    // actual billing, applied to the cached tokens in the current range.
    const cs = data?.cacheSavings;
    if (!cs || cs.totalCacheReadTokens <= 0 || cs.totalSavingsCostUsd <= 0) return 0;
    const savingsPerCachedToken = cs.totalSavingsCostUsd / cs.totalCacheReadTokens;
    const rangeCachedTokens = sessions.reduce((sum, s) => sum + s.totalCachedTokens, 0);
    return rangeCachedTokens * savingsPerCachedToken;
  })();
  $: cacheSavingsPct = (() => {
    if (rangeCost === 0) return 0;
    return (cacheSavingsValue / (rangeCost + cacheSavingsValue)) * 100;
  })();
  
  // Budget
  $: usagePct = budgetCredits > 0 ? ((periodCredits / budgetCredits) * 100) : 0;
  $: usageColor = usagePct >= 100 ? '#e57373' : usagePct >= 80 ? '#ffb74d' : '#81c784';
  
  // ── Cost drivers: top 5 models ──
  $: modelDrivers = (() => {
    const map = new Map<string, { model: string; costUsd: number; turns: number }>();
    sessions.forEach(s => {
      const cur = map.get(s.primaryModel) ?? { model: s.primaryModel, costUsd: 0, turns: 0 };
      cur.costUsd += s.totalCostUsd;
      cur.turns += s.turnCount;
      map.set(s.primaryModel, cur);
    });
    const all = Array.from(map.values()).sort((a, b) => b.costUsd - a.costUsd);
    const total = all.reduce((s, m) => s + m.costUsd, 0);
    return all.slice(0, 5).map(m => ({
      ...m,
      pct: total > 0 ? (m.costUsd / total) * 100 : 0,
    }));
  })();
  
  // ── Cost drivers: top 5 workspaces ──
  $: workspaceDrivers = (() => {
    const map = new Map<string, { name: string; costUsd: number; sessions: number }>();
    sessions.forEach(s => {
      const cur = map.get(s.workspace) ?? { name: s.workspace, costUsd: 0, sessions: 0 };
      cur.costUsd += s.totalCostUsd;
      cur.sessions += 1;
      map.set(s.workspace, cur);
    });
    const all = Array.from(map.values()).sort((a, b) => b.costUsd - a.costUsd);
    const total = all.reduce((s, w) => s + w.costUsd, 0);
    return all.slice(0, 5).map(w => ({
      ...w,
      pct: total > 0 ? (w.costUsd / total) * 100 : 0,
    }));
  })();
  
  // ── Smart alerts (top 3 from insight engine) ──
  $: smartAlerts = (() => {
    const a: Array<{ icon: string; color: string; text: string; tip: string }> = [];
    
    // Cache alert
    const totalCached = sessions.reduce((sum, s) => sum + s.totalCachedTokens, 0);
    const totalInput = sessions.reduce((sum, s) => sum + s.totalInputTokens, 0);
    const billable = totalInput + totalCached;
    const cacheHitPct = billable > 0 ? (totalCached / billable) * 100 : 0;
    if (cacheHitPct < 40 && billable > 5000) {
      a.push({ icon: '🔴', color: '#e57373', text: `Low cache hit: ${cacheHitPct.toFixed(1)}%`, tip: 'Break long chats to improve reuse' });
    } else if (cacheHitPct >= 70) {
      a.push({ icon: '🟢', color: '#81c784', text: `Cache hit: ${cacheHitPct.toFixed(1)}%`, tip: 'Excellent cache reuse' });
    } else {
      a.push({ icon: '🟡', color: '#ffb74d', text: `Cache hit: ${cacheHitPct.toFixed(1)}%`, tip: 'Reuse files across sessions' });
    }

    // Burn rate alert  
    if (budgetCredits > 0 && burnRate > 0) {
      const dailyBudget = budgetCredits / totalDaysInPeriod;
      if (burnRate > dailyBudget * 1.2) {
        a.push({ icon: '🔴', color: '#e57373', text: `Burn rate: ${formatCompactNumber(burnRate)} cr/day`, tip: `On pace for ${formatCompactNumber(projectedPeriodCredits)} cr` });
      } else if (burnRate > dailyBudget * 0.9) {
        a.push({ icon: '🟡', color: '#ffb74d', text: `Burn rate: ${formatCompactNumber(burnRate)} cr/day`, tip: 'Close to daily budget' });
      } else {
        a.push({ icon: '🟢', color: '#81c784', text: `Burn rate: ${formatCompactNumber(burnRate)} cr/day`, tip: 'On track' });
      }
    } else if (burnRate > 0) {
      a.push({ icon: '📊', color: '#4fc3f7', text: `Burn rate: ${formatCompactNumber(burnRate)} cr/day`, tip: 'Set a budget to track pacing' });
    }
    
    // I:O ratio
    const totalOutput = sessions.reduce((sum, s) => sum + s.totalOutputTokens, 0);
    const ioRatio = totalOutput > 0 ? billable / totalOutput : 0;
    if (ioRatio > 8 && totalOutput > 1000) {
      a.push({ icon: '🟡', color: '#ffb74d', text: `I:O ratio: ${ioRatio.toFixed(1)}:1`, tip: 'Consider tighter prompts' });
    } else if (totalOutput > 1000) {
      a.push({ icon: '🟢', color: '#81c784', text: `I:O ratio: ${ioRatio.toFixed(1)}:1`, tip: 'Healthy ratio' });
    }
    
    return a.slice(0, 3);
  })();
  
  // Forecast
  $: forecastVisible = rangeTurns >= 50 || periodCredits >= 0.5;
</script>

<div class="dashboard-tab">
  <!-- Hero cards -->
  <div class="hero-row">
    <div class="hero-card today">
      <div class="hero-label">Today</div>
      <div class="hero-value">{$formatUsd(todayCost)}</div>
      <div class="hero-sub">{formatCompactNumber(todayCredits)} cr · {todayTurns} turns</div>
      {#if todayCompareLabel}
        <div class="hero-compare" class:up={todayVsYesterday >= 0} class:down={todayVsYesterday < 0}>{todayCompareLabel}</div>
      {/if}
    </div>
    <div class="hero-card period">
      <div class="hero-label">This Period</div>
      <div class="hero-value">{$formatUsd(periodCost)}</div>
      <div class="hero-sub">{formatCompactNumber(periodCredits)} cr · {periodTurns} turns</div>
      <div class="hero-compare">{daysRemaining} days remaining</div>
    </div>
  </div>

  <!-- Secondary stat cards -->
  <div class="stat-row">
    <StatCard 
      label="Sessions"
      value={sessions.length}
      sub="in range"
    />
    <StatCard 
      label="Cache Savings"
      value={cacheSavingsValue > 0 ? $formatUsd(cacheSavingsValue) : '—'}
      sub={cacheSavingsValue > 0 ? `${cacheSavingsPct.toFixed(1)}% of spend` : 'No cache data'}
      valueColor={cacheSavingsValue > 0 ? '#81c784' : ''}
    />
    {#if forecastVisible}
      <StatCard 
        label="Forecast"
        value="{formatCompactNumber(projectedPeriodCredits)} cr"
        sub="Burn: {burnRate.toFixed(0)} cr/day"
        valueColor={budgetCredits > 0 && projectedPeriodCredits > budgetCredits ? '#e57373' : '#81c784'}
      />
    {:else}
      <StatCard label="Forecast" value="—" sub="Need more data" />
    {/if}
    {#if modelDrivers.length > 0}
      <StatCard 
        label="Top Model"
        value={modelDrivers[0].model}
        sub="{$formatUsd(modelDrivers[0].costUsd)} · {modelDrivers[0].pct.toFixed(0)}%"
      />
    {/if}
  </div>
  
  <!-- Daily chart -->
  <div class="chart-section">
    <div class="chart-with-help">
      <DailyChart />
      <button class="help-button" on:click={() => showHelpModal = true}>?</button>
    </div>
  </div>
  
  <!-- Cost drivers + Smart alerts side by side -->
  <div class="drivers-row">
    <div class="drivers-panel">
      <h3 class="section-title">Cost Drivers</h3>
      
      {#if modelDrivers.length > 0}
        <div class="driver-group">
          <span class="driver-group-label">Models</span>
          {#each modelDrivers as m}
            <div class="driver-item">
              <div class="driver-bar-container">
                <div class="driver-bar" style="width: {m.pct}%; background: #4fc3f7;"></div>
              </div>
              <span class="driver-name" title={m.model}>{m.model}</span>
              <span class="driver-value">{$formatUsd(m.costUsd)}</span>
              <span class="driver-pct">{m.pct.toFixed(0)}%</span>
            </div>
          {/each}
        </div>
      {/if}
      
      {#if workspaceDrivers.length > 1}
        <div class="driver-group">
          <span class="driver-group-label">Workspaces</span>
          {#each workspaceDrivers as w}
            <div class="driver-item">
              <div class="driver-bar-container">
                <div class="driver-bar" style="width: {w.pct}%; background: #ba68c8;"></div>
              </div>
              <span class="driver-name" title={w.name}>{w.name}</span>
              <span class="driver-value">{$formatUsd(w.costUsd)}</span>
              <span class="driver-pct">{w.pct.toFixed(0)}%</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
    
    <div class="alerts-panel">
      <h3 class="section-title">Smart Alerts</h3>
      {#if smartAlerts.length > 0}
        {#each smartAlerts as alert}
          <div class="smart-alert">
            <span class="alert-icon">{alert.icon}</span>
            <div class="alert-body">
              <div class="alert-text" style="color: {alert.color}">{alert.text}</div>
              <div class="alert-tip">{alert.tip}</div>
            </div>
          </div>
        {/each}
      {:else}
        <div class="no-alerts-msg">No alerts — usage looks healthy.</div>
      {/if}
      
      {#if budgetCredits > 0}
        <div class="budget-mini">
          <div class="budget-mini-header">
            <span>Budget</span>
            <span style="color: {usageColor}">{usagePct.toFixed(0)}%</span>
          </div>
          <BudgetBar percentage={usagePct} color={usageColor} />
          <div class="budget-mini-sub">{periodCredits.toFixed(0)} / {budgetCredits} cr</div>
        </div>
      {/if}
    </div>
  </div>
</div>

<HelpModal bind:show={showHelpModal} />

<style>
  .dashboard-tab {
    padding: 0;
  }
  
  /* ── Hero cards ── */
  .hero-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 14px;
  }
  
  .hero-card {
    background: color-mix(in srgb, var(--vscode-editorWidget-background) 72%, #103449 28%);
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, #2aa5ff 40%);
    border-radius: 12px;
    padding: 18px 20px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
    position: relative;
    overflow: hidden;
  }
  
  .hero-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
  }
  
  .hero-card.today::before {
    background: linear-gradient(90deg, #4fc3f7, #81c784);
  }
  
  .hero-card.period::before {
    background: linear-gradient(90deg, #ba68c8, #4fc3f7);
  }
  
  .hero-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
    margin-bottom: 6px;
  }
  
  .hero-value {
    font-size: 28px;
    font-weight: 800;
    color: var(--vscode-editor-foreground);
    line-height: 1.1;
  }
  
  .hero-sub {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    margin-top: 4px;
  }
  
  .hero-compare {
    font-size: 11px;
    margin-top: 6px;
    font-weight: 500;
    color: var(--vscode-descriptionForeground);
  }
  
  .hero-compare.up {
    color: #e57373;
  }
  
  .hero-compare.down {
    color: #81c784;
  }
  
  /* ── Stat row ── */
  .stat-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }
  
  /* ── Chart ── */
  .chart-section {
    margin-bottom: 14px;
  }
  
  .chart-with-help {
    position: relative;
  }
  
  .help-button {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-button-border);
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
  }
  
  .help-button:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  
  /* ── Drivers + Alerts ── */
  .drivers-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  
  .drivers-panel, .alerts-panel {
    background: color-mix(in srgb, var(--vscode-editorWidget-background) 78%, #103449 22%);
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, #2aa5ff 30%);
    border-radius: 10px;
    padding: 14px 16px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  }
  
  .section-title {
    margin: 0 0 12px 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--vscode-editor-foreground);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  
  .driver-group {
    margin-bottom: 14px;
  }
  
  .driver-group:last-child {
    margin-bottom: 0;
  }
  
  .driver-group-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
    display: block;
  }
  
  .driver-item {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 8px;
    align-items: center;
    padding: 3px 0;
    font-size: 12px;
    position: relative;
  }
  
  .driver-bar-container {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 0;
    pointer-events: none;
  }
  
  .driver-bar {
    height: 100%;
    border-radius: 3px;
    opacity: 0.12;
    transition: width 0.3s ease;
  }
  
  .driver-name {
    position: relative;
    z-index: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--vscode-editor-foreground);
  }
  
  .driver-value {
    position: relative;
    z-index: 1;
    font-weight: 600;
    color: var(--vscode-editor-foreground);
    text-align: right;
  }
  
  .driver-pct {
    position: relative;
    z-index: 1;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    min-width: 30px;
    text-align: right;
  }
  
  /* ── Smart alerts ── */
  .smart-alert {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 10px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    margin-bottom: 8px;
  }
  
  .alert-icon {
    font-size: 16px;
    flex-shrink: 0;
    margin-top: 1px;
  }
  
  .alert-body {
    flex: 1;
    min-width: 0;
  }
  
  .alert-text {
    font-size: 12px;
    font-weight: 600;
  }
  
  .alert-tip {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-top: 2px;
  }
  
  .no-alerts-msg {
    padding: 8px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  
  /* ── Budget mini ── */
  .budget-mini {
    margin-top: 12px;
    padding: 10px 12px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
  }
  
  .budget-mini-header {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 6px;
  }
  
  .budget-mini-sub {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-top: 4px;
  }
</style>
