<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import StatCard from '../shared/StatCard.svelte';
  import BudgetBar from '../shared/BudgetBar.svelte';
  import DataTable from '../shared/DataTable.svelte';
  import TokenTrendChart from '../charts/TokenTrendChart.svelte';
  import SurfacePieChart from '../charts/SurfacePieChart.svelte';
  
  $: data = $dashboardData;
  $: alerts = data?.alerts ?? [];
  $: playbook = data?.playbook ?? [];
  $: allSessions = data?.allSessions ?? [];
  $: dailyAgentBreakdown = data?.dailyAgentBreakdown ?? [];
  
  $: filteredSessions = allSessions.filter(s => {
    if ($filterState.fromMs !== null && s.startTimestamp < $filterState.fromMs) return false;
    if ($filterState.toMs !== null && s.startTimestamp > $filterState.toMs) return false;
    return true;
  });
  
  $: filteredInsightMetrics = (() => {
    const totalInput = filteredSessions.reduce((sum, s) => sum + s.totalInputTokens, 0);
    const totalCached = filteredSessions.reduce((sum, s) => sum + s.totalCachedTokens, 0);
    const totalOutput = filteredSessions.reduce((sum, s) => sum + s.totalOutputTokens, 0);
    const totalTurns = filteredSessions.reduce((sum, s) => sum + s.turnCount, 0);
    const errorTurns = filteredSessions.filter(s => s.status === 'error').length;
    
    const billableInput = totalInput + totalCached;
    const cacheHitPct = billableInput > 0 ? (totalCached / billableInput) * 100 : 0;
    
    return {
      totalInputTokens: totalInput,
      totalCachedTokens: totalCached,
      totalOutputTokens: totalOutput,
      totalTurns,
      errorTurns,
      cacheHitPct,
      ioRatioDays: [],
    };
  })();
  
  $: filteredAgentBreakdown = (() => {
    const agentMap = new Map<string, {
      agentName: string;
      totalCostUsd: number;
      totalCredits: number;
      turnCount: number;
    }>();
    
    dailyAgentBreakdown.forEach(day => {
      const dayTs = new Date(day.period + 'T00:00:00').getTime();
      const dayEndTs = dayTs + 86400000 - 1;
      
      if ($filterState.fromMs !== null && dayEndTs < $filterState.fromMs) return;
      if ($filterState.toMs !== null && dayTs > $filterState.toMs) return;
      
      const current = agentMap.get(day.agentName) ?? {
        agentName: day.agentName,
        totalCostUsd: 0,
        totalCredits: 0,
        turnCount: 0,
      };
      current.totalCostUsd += day.totalCostUsd;
      current.totalCredits += day.totalCredits;
      current.turnCount += day.turnCount;
      agentMap.set(day.agentName, current);
    });
    
    const agents = Array.from(agentMap.values());
    const totalCost = agents.reduce((sum, a) => sum + a.totalCostUsd, 0);
    
    return agents.map(a => ({
      ...a,
      percentage: totalCost > 0 ? (a.totalCostUsd / totalCost) * 100 : 0,
    })).sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  })();
  
  $: filteredCacheSavings = (() => {
    const modelMap = new Map<string, {
      modelFamily: string;
      cacheWriteTokens: number;
      cacheReadTokens: number;
      savingsCostUsd: number;
      savingsCredits: number;
    }>();
    
    filteredSessions.forEach(s => {
      s.modelBreakdown?.forEach(m => {
        const current = modelMap.get(m.model) ?? {
          modelFamily: m.model,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          savingsCostUsd: 0,
          savingsCredits: 0,
        };
        current.cacheReadTokens += m.totalCachedTokens;
        modelMap.set(m.model, current);
      });
    });
    
    const models = Array.from(modelMap.values());
    const totalSavingsCostUsd = models.reduce((sum, m) => sum + m.savingsCostUsd, 0);
    
    return models.map(m => ({
      ...m,
      percentage: totalSavingsCostUsd > 0 ? (m.savingsCostUsd / totalSavingsCostUsd) * 100 : 0,
    })).sort((a, b) => b.savingsCostUsd - a.savingsCostUsd);
  })();
  
  $: filteredPeriodAggregate = (() => {
    const costUsd = filteredSessions.reduce((sum, s) => sum + s.totalCostUsd, 0);
    const credits = filteredSessions.reduce((sum, s) => sum + s.totalCredits, 0);
    const turns = filteredSessions.reduce((sum, s) => sum + s.turnCount, 0);
    return { costUsd, credits, turns };
  })();
  
  $: insightMetrics = filteredInsightMetrics;
  $: agentBreakdown = filteredAgentBreakdown;
  
  $: totalBillableInput = (insightMetrics?.totalInputTokens ?? 0) + (insightMetrics?.totalCachedTokens ?? 0);
  $: avgInputPerTurn = insightMetrics && insightMetrics.totalTurns > 0
    ? Math.round((totalBillableInput / insightMetrics.totalTurns) / 100) / 10
    : 0;
  
  $: ioRatioLabel = insightMetrics && insightMetrics.totalOutputTokens > 0
    ? `${Math.round(totalBillableInput / insightMetrics.totalOutputTokens)}:1`
    : '—:1';
  
  $: cacheHitColor = (() => {
    const pct = insightMetrics?.cacheHitPct ?? 0;
    if (pct >= 70) return '#81c784';
    if (pct >= 40) return '#ffb74d';
    return '#e57373';
  })();
  
  $: cacheHitNote = (() => {
    const pct = insightMetrics?.cacheHitPct ?? 0;
    if (pct >= 70) return 'Excellent';
    if (pct >= 40) return 'Moderate — reuse files across sessions';
    return 'Low — avoid large one-off pastes';
  })();
  
  $: avgInputStyle = avgInputPerTurn > 20 ? 'color:#e57373' : '';
  $: avgInputNote = avgInputPerTurn > 20 
    ? '⚠ Context bloat — consider reducing attached files' 
    : 'within normal range';
  
  $: errorStyle = insightMetrics && insightMetrics.errorTurns > 0 ? 'color:#e57373' : '';
  $: errorNote = insightMetrics && insightMetrics.totalTurns > 0
    ? `${((insightMetrics.errorTurns / insightMetrics.totalTurns) * 100).toFixed(1)}% of total turns`
    : 'no data';
  
  const AGENT_LABEL_MAP: Record<string, string> = {
    'GitHub Copilot Chat': 'Sidebar Chat',
    'panel/editAgent': 'Inline Chat',
    'XtabProvider': 'Next Edit Suggestions',
    'summarizeConversationHistory': 'Context Summarization',
    'progressMessages': 'Background Processing',
    'title': 'Title Generation',
  };
  
  $: surfaceCostView = (() => {
    const totalCost = agentBreakdown.reduce((sum, a) => sum + a.totalCostUsd, 0);
    return agentBreakdown
      .filter(a => a.totalCostUsd > 0)
      .map(a => ({
        surface: AGENT_LABEL_MAP[a.agentName] ?? a.agentName ?? 'Other',
        pct: totalCost > 0 ? (a.totalCostUsd / totalCost) * 100 : 0,
        cost: a.totalCostUsd,
        credits: a.totalCredits,
        turns: a.turnCount,
      }));
  })();
  
  const surfaceColumns = [
    { key: 'surface', label: 'Surface', type: 'string' as const },
    { key: 'pct', label: '%', type: 'number' as const },
    { key: 'cost', label: 'Cost', type: 'number' as const },
    { key: 'credits', label: 'Credits', type: 'number' as const },
    { key: 'turns', label: 'Turns', type: 'number' as const },
  ];
  
  $: surfaceRows = surfaceCostView.map(s => ({
    surface: s.surface,
    pct: s.pct.toFixed(1),
    cost: `$${s.cost.toFixed(3)}`,
    credits: s.credits.toFixed(1),
    turns: s.turns,
  }));
  
  $: cacheSavingsValue = filteredCacheSavings.reduce((sum, m) => sum + m.savingsCostUsd, 0);
  $: cacheSavingsCredits = filteredCacheSavings.reduce((sum, m) => sum + m.savingsCredits, 0);
  $: cacheSavingsPct = (() => {
    if (filteredPeriodAggregate.costUsd === 0) return 0;
    return (cacheSavingsValue / (filteredPeriodAggregate.costUsd + cacheSavingsValue)) * 100;
  })();
  
  $: cacheSavingsTopModels = filteredCacheSavings
    .filter(m => m.savingsCostUsd > 0)
    .slice(0, 6);
  
  const cacheColumns = [
    { key: 'model', label: 'Model', type: 'string' as const },
    { key: 'pct', label: '%', type: 'number' as const },
    { key: 'saved', label: 'Saved', type: 'number' as const },
  ];
  
  $: cacheRows = cacheSavingsTopModels.map(m => ({
    model: m.modelFamily,
    pct: m.percentage.toFixed(0),
    saved: `$${m.savingsCostUsd.toFixed(3)}`,
  }));
  
  $: rangeAlerts = (() => {
    const alerts: string[] = [];
    const cacheHitPct = insightMetrics?.cacheHitPct ?? 0;
    const totalBillableInput = (insightMetrics?.totalInputTokens ?? 0) + (insightMetrics?.totalCachedTokens ?? 0);
    const totalOutput = insightMetrics?.totalOutputTokens ?? 0;
    const avgInputPerTurn = insightMetrics && insightMetrics.totalTurns > 0
      ? Math.round((totalBillableInput / insightMetrics.totalTurns) / 100) / 10
      : 0;
    
    if (cacheHitPct < 40 && totalBillableInput > 5000) {
      alerts.push('Low cache reuse in this range. Keep related tasks in one session to improve hit rate.');
    }
    if (avgInputPerTurn > 20) {
      alerts.push('High input per turn. Reduce attached context and split very broad prompts.');
    }
    if (totalOutput > 0 && (totalBillableInput / Math.max(1, totalOutput)) > 8) {
      alerts.push('High input-to-output ratio. Consider tighter prompts and smaller context windows.');
    }
    
    return alerts;
  })();
</script>

<div class="insights-tab">
  <div class="playbook-section">
    <h3>Token Savings Playbook — Today</h3>
    
    {#if alerts.length > 0}
      <div class="alert-cards">
        {#each alerts as alert}
          <div class="alert-card alert-{alert.severity}">
            <div class="alert-header">
              <strong>{alert.title}</strong>
              <span class="alert-metric">{alert.metric.label}: <strong>{alert.metric.value}</strong></span>
            </div>
            <div class="alert-message">{alert.message}</div>
            <div class="alert-tip">
              <strong>Tip:</strong> {alert.tip}
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="no-alerts">
        ✅ No active alerts — your token usage habits look efficient today.
      </div>
    {/if}
    
    <table class="playbook-table">
      <thead>
        <tr>
          <th>Strategy</th>
          <th>Status</th>
          <th>Your Metric</th>
          <th>Impact</th>
        </tr>
      </thead>
      <tbody>
        {#each playbook as row}
          <tr>
            <td><strong>{row.strategy}</strong></td>
            <td>{row.statusEmoji} {row.statusLabel}</td>
            <td class="muted">{row.metricDesc}</td>
            <td class="muted">{row.impact}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  
  {#if rangeAlerts.length > 0}
    <div class="range-alerts">
      {#each rangeAlerts as alert, i}
        <div class="range-alert">
          <strong>Token Alert {i + 1}:</strong> {alert}
        </div>
      {/each}
    </div>
  {/if}
  
  <div class="metrics-section">
    <div class="stat-row">
      <StatCard 
        label="Cache Hit Rate (Range)"
        value="{(insightMetrics?.cacheHitPct ?? 0).toFixed(1)}%"
        sub="{((insightMetrics?.totalCachedTokens ?? 0) / 1000).toFixed(0)}K cached of {(totalBillableInput / 1000).toFixed(0)}K total input · {cacheHitNote}"
        valueColor={cacheHitColor}
      >
        <BudgetBar percentage={insightMetrics?.cacheHitPct ?? 0} color={cacheHitColor} />
      </StatCard>
      
      <StatCard 
        label="Input:Output Ratio (Range)"
        value={ioRatioLabel}
        sub="{(totalBillableInput / 1000).toFixed(0)}K in · {((insightMetrics?.totalOutputTokens ?? 0) / 1000).toFixed(0)}K out"
      />
      
      <StatCard 
        label="Avg Input / Turn (Range)"
        value="{avgInputPerTurn}K"
        sub={avgInputNote}
        valueColor={avgInputPerTurn > 20 ? '#e57373' : ''}
      />
      
      <StatCard 
        label="Error Turns (30d)"
        value={insightMetrics?.errorTurns ?? 0}
        sub={errorNote}
        valueColor={insightMetrics && insightMetrics.errorTurns > 0 ? '#e57373' : ''}
      />
    </div>
    
    <div class="charts-grid">
      <div class="chart-section">
        <h4>Token Flow — Current range (stacked)</h4>
        <TokenTrendChart />
      </div>
      
      <div class="chart-section">
        <h4>Spend by Action Type (30d)</h4>
        <SurfacePieChart />
      </div>
    </div>
    
    {#if surfaceCostView.length > 0}
      <div class="surface-breakdown">
        <h4>Action Type Breakdown (30d)</h4>
        <DataTable 
          columns={surfaceColumns}
          rows={surfaceRows}
        />
      </div>
    {/if}
    
    {#if cacheSavingsValue > 0}
      <div class="cache-savings">
        <div class="cache-header">
          <h4>Cache Savings (Period)</h4>
          <span class="cache-total">${cacheSavingsValue.toFixed(3)}</span>
          <span class="cache-sub">{cacheSavingsCredits.toFixed(1)} cr · {cacheSavingsPct.toFixed(1)}% of period spend</span>
        </div>
        <DataTable 
          columns={cacheColumns}
          rows={cacheRows}
        />
      </div>
    {/if}
  </div>
</div>

<style>
  .insights-tab {
    padding: 0;
  }
  
  .playbook-section {
    margin-bottom: 24px;
  }
  
  .playbook-section h3 {
    margin: 0 0 12px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }
  
  .alert-cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }
  
  .alert-card {
    padding: 10px 14px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-left: 3px solid;
    border-radius: 4px;
  }
  
  .alert-info {
    border-left-color: #4fc3f7;
  }
  
  .alert-warning {
    border-left-color: #ffb74d;
  }
  
  .alert-critical {
    border-left-color: #e57373;
  }
  
  .alert-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 4px;
  }
  
  .alert-header strong {
    font-size: 12px;
  }
  
  .alert-metric {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  
  .alert-message {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 6px;
  }
  
  .alert-tip {
    font-size: 11px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 3px;
    padding: 6px 8px;
  }
  
  .no-alerts {
    padding: 10px 12px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 16px;
  }
  
  .playbook-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  
  .playbook-table th,
  .playbook-table td {
    padding: 8px;
    text-align: left;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  
  .playbook-table th {
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
  }
  
  .playbook-table .muted {
    color: var(--vscode-descriptionForeground);
  }
  
  .range-alerts {
    margin-bottom: 16px;
  }
  
  .range-alert {
    padding: 8px 10px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-left: 3px solid #ffb74d;
    border-radius: 4px;
    font-size: 12px;
    margin-bottom: 6px;
  }
  
  .metrics-section {
    border-top: 1px solid var(--vscode-panel-border);
    padding-top: 16px;
  }
  
  .stat-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }
  
  .charts-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 16px;
  }
  
  .chart-section h4 {
    margin: 0 0 8px 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .surface-breakdown {
    margin-bottom: 16px;
  }
  
  .surface-breakdown h4 {
    margin: 0 0 8px 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .cache-savings {
    border-top: 1px solid var(--vscode-panel-border);
    padding-top: 16px;
  }
  
  .cache-header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 12px;
  }
  
  .cache-header h4 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .cache-total {
    font-size: 18px;
    font-weight: 700;
    color: #81c784;
  }
  
  .cache-sub {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
</style>
