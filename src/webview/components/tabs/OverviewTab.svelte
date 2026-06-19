<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import StatCard from '../shared/StatCard.svelte';
  import BudgetBar from '../shared/BudgetBar.svelte';
  import DailyChart from '../charts/DailyChart.svelte';
  import Heatmap from '../charts/Heatmap.svelte';
  import HelpModal from '../shared/HelpModal.svelte';
  
  let showHelpModal = false;
  
  $: data = $dashboardData;
  $: budgetCredits = data?.budgetCredits ?? 180;
  $: periodCredits = data?.periodCredits ?? 0;
  $: monthTotal = data?.monthTotal ?? { costUsd: 0, credits: 0, turns: 0 };
  $: allSessions = data?.allSessions ?? [];
  $: billingPeriodStartMs = data?.billingPeriodStartMs ?? 0;
  $: billingPeriodEndMs = data?.billingPeriodEndMs ?? 0;
  
  $: filteredSessions = allSessions.filter(s => {
    if ($filterState.fromMs !== null && s.startTimestamp < $filterState.fromMs) return false;
    if ($filterState.toMs !== null && s.startTimestamp > $filterState.toMs) return false;
    return true;
  });
  
  $: rangeCost = filteredSessions.reduce((sum, s) => sum + s.totalCostUsd, 0);
  $: rangeCredits = filteredSessions.reduce((sum, s) => sum + s.totalCredits, 0);
  $: rangeTurns = filteredSessions.reduce((sum, s) => sum + s.turnCount, 0);
  
  $: usagePct = budgetCredits > 0 ? ((periodCredits / budgetCredits) * 100) : 0;
  $: usageColor = usagePct >= 100 ? '#e57373' : usagePct >= 80 ? '#ffb74d' : '#81c784';
  
  $: topWorkspace = (() => {
    const workspaceMap = new Map<string, { costUsd: number; credits: number; sessions: number; turns: number }>();
    
    filteredSessions.forEach(s => {
      const current = workspaceMap.get(s.workspace) ?? { costUsd: 0, credits: 0, sessions: 0, turns: 0 };
      current.costUsd += s.totalCostUsd;
      current.credits += s.totalCredits;
      current.sessions += 1;
      current.turns += s.turnCount;
      workspaceMap.set(s.workspace, current);
    });
    
    const sorted = Array.from(workspaceMap.entries())
      .sort((a, b) => b[1].costUsd - a[1].costUsd);
    
    if (sorted.length === 0) return { label: '—', costUsd: 0, credits: 0, sessions: 0 };
    
    const [workspace, stats] = sorted[0];
    return { label: workspace, ...stats };
  })();

  $: workspaceLeaderboard = (() => {
    const workspaceMap = new Map<string, { costUsd: number; credits: number; sessions: number; turns: number }>();
    
    filteredSessions.forEach(s => {
      const current = workspaceMap.get(s.workspace) ?? { costUsd: 0, credits: 0, sessions: 0, turns: 0 };
      current.costUsd += s.totalCostUsd;
      current.credits += s.totalCredits;
      current.sessions += 1;
      current.turns += s.turnCount;
      workspaceMap.set(s.workspace, current);
    });
    
    return Array.from(workspaceMap.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.credits - a.credits);
  })();
  
  $: avgResponseMs = (() => {
    const totalDuration = filteredSessions.reduce((sum, s) => sum + (s.avgDurationMs * s.turnCount), 0);
    const totalTurns = filteredSessions.reduce((sum, s) => sum + s.turnCount, 0);
    return totalTurns > 0 ? totalDuration / totalTurns : 0;
  })();
  
  $: avgResponseLabel = avgResponseMs >= 1000 
    ? `${(avgResponseMs / 1000).toFixed(1)}s`
    : `${Math.round(avgResponseMs)}ms`;
  
  $: cacheSavingsValue = (() => {
    const totalCachedTokens = filteredSessions.reduce((sum, s) => sum + s.totalCachedTokens, 0);
    const totalInputTokens = filteredSessions.reduce((sum, s) => sum + s.totalInputTokens, 0);
    const billableInput = totalInputTokens + totalCachedTokens;
    if (billableInput === 0) return 0;
    const cacheHitPct = totalCachedTokens / billableInput;
    const avgInputCostPerToken = rangeCost / Math.max(1, billableInput);
    return totalCachedTokens * avgInputCostPerToken * 0.9;
  })();
  
  $: cacheSavingsCredits = cacheSavingsValue * 100;
  $: cacheSavingsPct = (() => {
    if (rangeCost === 0) return 0;
    return (cacheSavingsValue / (rangeCost + cacheSavingsValue)) * 100;
  })();
  
  $: daysRemaining = Math.max(0, Math.ceil((billingPeriodEndMs - Date.now()) / (24 * 60 * 60 * 1000)));
  $: msInDay = 24 * 60 * 60 * 1000;
  $: totalDaysInPeriod = Math.max(1, Math.ceil((billingPeriodEndMs - billingPeriodStartMs) / msInDay));
  $: daysSincePeriodStart = Math.max(1, Math.ceil((Date.now() - billingPeriodStartMs) / msInDay));
  $: burnRate = daysSincePeriodStart > 0 ? periodCredits / daysSincePeriodStart : 0;
  $: projectedPeriodCredits = burnRate * totalDaysInPeriod;
  $: forecastVisible = rangeTurns >= 50 || periodCredits >= 0.5;
  $: forecastOverage = projectedPeriodCredits - budgetCredits;
</script>

<div class="overview-tab">
  <div class="stat-row">
    <StatCard 
      label="Range Cost"
      value="${rangeCost.toFixed(2)}"
      sub="{rangeCredits.toFixed(0)} cr · {rangeTurns} turns"
    />
    
    <StatCard 
      label="Range Credits"
      value="{rangeCredits.toFixed(0)} cr"
      sub="${rangeCost.toFixed(2)} · {rangeTurns} turns"
    />
    
    {#if budgetCredits > 0}
      <StatCard 
        label="Budget Used (Period)"
        value="{usagePct.toFixed(1)}%"
        sub="{periodCredits.toFixed(0)} / {budgetCredits} cr"
        valueColor={usageColor}
      >
        <BudgetBar percentage={usagePct} color={usageColor} />
      </StatCard>
    {:else}
      <StatCard 
        label="Budget Used (Period)"
        value="No budget set"
        sub="{periodCredits.toFixed(0)} cr used"
      />
    {/if}
    
    <StatCard 
      label="Days Remaining"
      value={daysRemaining}
      sub={budgetCredits > 0 ? `~${((budgetCredits - periodCredits) / Math.max(1, daysRemaining)).toFixed(1)} cr/day budget` : 'of billing period'}
    />
    
    {#if forecastVisible}
      <StatCard label="Forecast (Period End)">
        <div class="stat-value">{projectedPeriodCredits.toFixed(1)} cr</div>
        <div class="stat-sub">Burn rate: {burnRate.toFixed(2)} cr/day</div>
        {#if budgetCredits > 0}
          {#if forecastOverage > 0}
            <div class="stat-sub" style="color: var(--vscode-errorForeground)">
              +{forecastOverage.toFixed(1)} cr over budget
            </div>
          {:else}
            <div class="stat-sub">
              {Math.abs(forecastOverage).toFixed(1)} cr under budget
            </div>
          {/if}
        {/if}
      </StatCard>
    {:else}
      <StatCard label="Forecast (Period End)">
        <div class="stat-value">-</div>
        <div class="stat-sub">Forecast available once more usage data is collected</div>
        <div class="stat-sub">(>= 50 turns or >= 0.50 credits)</div>
      </StatCard>
    {/if}
    
    <StatCard 
      label="Chat Sessions"
      value={filteredSessions.length}
      sub="current range"
    />
    
    <StatCard 
      label="Top Workspace (Range)"
      value={topWorkspace.label}
      sub="${topWorkspace.costUsd.toFixed(2)} · {topWorkspace.sessions} sessions"
    />
    
    <StatCard 
      label="Avg Response"
      value={avgResponseLabel}
      sub="last 30 days"
    />
    
    <StatCard 
      label="Cache Savings (Range)"
      value={cacheSavingsValue > 0 ? `$${cacheSavingsValue.toFixed(2)}` : '—'}
      sub={cacheSavingsValue > 0 ? `${cacheSavingsCredits.toFixed(1)} cr · ${cacheSavingsPct.toFixed(1)}% of spend` : 'No cache data this range'}
      valueColor={cacheSavingsValue > 0 ? '#81c784' : ''}
    />
  </div>

  {#if workspaceLeaderboard.length > 1}
    <div class="workspace-breakdown">
      <details>
        <summary>Workspace Breakdown ({workspaceLeaderboard.length} repos)</summary>
        <table class="workspace-table">
          <thead>
            <tr>
              <th>Workspace</th>
              <th>Credits</th>
              <th>Cost</th>
              <th>Sessions</th>
              <th>Turns</th>
            </tr>
          </thead>
          <tbody>
            {#each workspaceLeaderboard as ws}
              <tr>
                <td class="ws-name" title={ws.name}>{ws.name}</td>
                <td>{ws.credits.toFixed(1)}</td>
                <td>${ws.costUsd.toFixed(2)}</td>
                <td>{ws.sessions}</td>
                <td>{ws.turns}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </details>
    </div>
  {/if}
  
  <div class="charts-section">
    <div class="chart-with-help">
      <DailyChart />
      <button class="help-button" on:click={() => showHelpModal = true}>
        ?
      </button>
    </div>
    
    <Heatmap />
  </div>
</div>

<HelpModal bind:show={showHelpModal} />

<style>
  .overview-tab {
    padding: 0;
  }
  
  .stat-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }
  
  .charts-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
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

  .workspace-breakdown {
    margin-bottom: 16px;
  }

  .workspace-breakdown summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 12px;
    color: var(--vscode-foreground);
    padding: 6px 0;
    user-select: none;
  }

  .workspace-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    margin-top: 6px;
  }

  .workspace-table th {
    text-align: left;
    padding: 4px 8px;
    color: var(--vscode-descriptionForeground);
    border-bottom: 1px solid var(--vscode-widget-border);
    font-weight: 600;
  }

  .workspace-table td {
    padding: 4px 8px;
    border-bottom: 1px solid var(--vscode-widget-border, transparent);
  }

  .workspace-table tr:hover td {
    background: var(--vscode-list-hoverBackground);
  }

  .ws-name {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
