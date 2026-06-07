<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import StatCard from '../shared/StatCard.svelte';
  import DataTable from '../shared/DataTable.svelte';
  
  $: data = $dashboardData;
  $: modelBreakdown = data?.modelBreakdown ?? [];
  $: allSessions = data?.allSessions ?? [];
  
  $: filteredSessions = allSessions.filter(s => {
    if ($filterState.fromMs !== null && s.startTimestamp < $filterState.fromMs) return false;
    if ($filterState.toMs !== null && s.startTimestamp > $filterState.toMs) return false;
    return true;
  });
  
  $: totalInput = filteredSessions.reduce((sum, s) => sum + s.totalInputTokens, 0);
  $: totalCached = filteredSessions.reduce((sum, s) => sum + s.totalCachedTokens, 0);
  $: totalOutput = filteredSessions.reduce((sum, s) => sum + s.totalOutputTokens, 0);
  $: totalTurns = filteredSessions.reduce((sum, s) => sum + s.turnCount, 0);
  
  $: billableInput = totalInput + totalCached;
  $: cacheHitPct = billableInput > 0 ? (totalCached / billableInput) * 100 : 0;
  $: ioRatio = totalOutput > 0 ? Math.round(billableInput / totalOutput) : 0;
  $: totalTokens = billableInput + totalOutput;
  $: avgPerTurn = totalTurns > 0 ? Math.round(totalTokens / totalTurns) : 0;
  
  $: topModel = modelBreakdown.reduce((top, m) => {
    if (!top || m.totalCostUsd > top.totalCostUsd) return m;
    return top;
  }, null as typeof modelBreakdown[0] | null);
  
  const tokenColumns = [
    { key: 'model', label: 'Model', type: 'string' as const },
    { key: 'turns', label: 'Turns', type: 'number' as const },
    { key: 'totalCost', label: 'Total Cost', type: 'number' as const },
    { key: 'avgCost', label: 'Avg/Turn', type: 'number' as const },
    { key: 'avgCredits', label: 'Credits/Turn', type: 'number' as const },
  ];
  
  $: tokenRows = modelBreakdown.map(m => {
    const avgCost = m.turnCount > 0 ? m.totalCostUsd / m.turnCount : 0;
    const avgCredits = m.turnCount > 0 ? m.totalCredits / m.turnCount : 0;
    
    return {
      model: m.model,
      turns: m.turnCount,
      totalCost: `$${m.totalCostUsd.toFixed(2)}`,
      avgCost: `$${avgCost.toFixed(4)}`,
      avgCredits: avgCredits.toFixed(2),
    };
  });
  
  function formatCompactNumber(value: number): string {
    if (!Number.isFinite(value)) return '0';
    if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(1) + 'M';
    if (Math.abs(value) >= 1000) return (value / 1000).toFixed(1) + 'K';
    return String(Math.round(value));
  }
</script>

<div class="tokens-tab">
  <div class="stat-row">
    <StatCard 
      label="Total Input Tokens (Range)"
      value={formatCompactNumber(billableInput)}
      sub="{formatCompactNumber(totalInput)} net + {formatCompactNumber(totalCached)} cached"
    />
    
    <StatCard 
      label="Cached Input Tokens (Range)"
      value={formatCompactNumber(totalCached)}
      sub="cache hit {cacheHitPct.toFixed(1)}%"
    />
    
    <StatCard 
      label="Output Tokens (Range)"
      value={formatCompactNumber(totalOutput)}
      sub="I:O ratio {totalOutput > 0 ? `${ioRatio}:1` : '—:1'}"
    />
    
    <StatCard 
      label="Avg Tokens / Turn (Range)"
      value={formatCompactNumber(avgPerTurn)}
      sub="{totalTurns} turns in range"
    />
    
    <StatCard 
      label="Top Cost Model (Range)"
      value={topModel ? topModel.model : 'N/A'}
      sub={topModel ? `$${topModel.totalCostUsd.toFixed(2)} (${topModel.percentage.toFixed(1)}%)` : '$0.00 (0.0%)'}
    />
  </div>
  
  <div class="table-section">
    <h3>Cost per Model per Turn</h3>
    <DataTable 
      columns={tokenColumns}
      rows={tokenRows}
    />
  </div>
</div>

<style>
  .tokens-tab {
    padding: 0;
  }
  
  .stat-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-bottom: 24px;
  }
  
  .table-section h3 {
    margin: 0 0 12px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }
</style>
