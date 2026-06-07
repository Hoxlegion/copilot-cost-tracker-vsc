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
  $: cacheSavings = data?.cacheSavings;
  
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
    const workspaceMap = new Map<string, { costUsd: number; sessions: number }>();
    
    filteredSessions.forEach(s => {
      const current = workspaceMap.get(s.workspace) ?? { costUsd: 0, sessions: 0 };
      current.costUsd += s.totalCostUsd;
      current.sessions += 1;
      workspaceMap.set(s.workspace, current);
    });
    
    const sorted = Array.from(workspaceMap.entries())
      .sort((a, b) => b[1].costUsd - a[1].costUsd);
    
    if (sorted.length === 0) return { label: '—', costUsd: 0, sessions: 0 };
    
    const [workspace, stats] = sorted[0];
    return { label: workspace, ...stats };
  })();
  
  $: avgResponseMs = (() => {
    const totalDuration = filteredSessions.reduce((sum, s) => sum + (s.avgDurationMs * s.turnCount), 0);
    const totalTurns = filteredSessions.reduce((sum, s) => sum + s.turnCount, 0);
    return totalTurns > 0 ? totalDuration / totalTurns : 0;
  })();
  
  $: avgResponseLabel = avgResponseMs >= 1000 
    ? `${(avgResponseMs / 1000).toFixed(1)}s`
    : `${Math.round(avgResponseMs)}ms`;
  
  $: cacheSavingsValue = cacheSavings?.totalSavingsCostUsd ?? 0;
  $: cacheSavingsCredits = cacheSavings?.totalSavingsCredits ?? 0;
  $: cacheSavingsPct = (() => {
    if (!cacheSavings || rangeCost === 0) return 0;
    return (cacheSavingsValue / (rangeCost + cacheSavingsValue)) * 100;
  })();
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
    
    <StatCard 
      label="Range Turns"
      value={rangeTurns}
      sub="${rangeCost.toFixed(2)} · {rangeCredits.toFixed(0)} cr"
    />
    
    <StatCard 
      label="Budget Used (Period)"
      value="{usagePct.toFixed(1)}%"
      sub="{periodCredits.toFixed(0)} / {budgetCredits} cr"
      valueColor={usageColor}
    >
      <BudgetBar percentage={usagePct} color={usageColor} />
    </StatCard>
    
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
      label="LLM Calls"
      value={rangeTurns}
      sub="turns in range"
    />
    
    <StatCard 
      label="Avg Response"
      value={avgResponseLabel}
      sub="last 30 days"
    />
    
    <StatCard 
      label="Cache Savings (Period)"
      value={cacheSavingsValue > 0 ? `$${cacheSavingsValue.toFixed(3)}` : '—'}
      sub={cacheSavingsValue > 0 ? `${cacheSavingsCredits.toFixed(1)} cr · ${cacheSavingsPct.toFixed(1)}% of spend` : 'No cache data this period'}
      valueColor={cacheSavingsValue > 0 ? '#81c784' : ''}
    />
  </div>
  
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
</style>
