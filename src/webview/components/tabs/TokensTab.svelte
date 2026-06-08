<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import StatCard from '../shared/StatCard.svelte';
  
  $: data = $dashboardData;
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
  
  $: filteredModelBreakdown = (() => {
    const modelMap = new Map<string, {
      model: string;
      totalCostUsd: number;
      totalCredits: number;
      turnCount: number;
    }>();
    
    filteredSessions.forEach(s => {
      const current = modelMap.get(s.primaryModel) ?? {
        model: s.primaryModel,
        totalCostUsd: 0,
        totalCredits: 0,
        turnCount: 0,
      };
      current.totalCostUsd += s.totalCostUsd;
      current.totalCredits += s.totalCredits;
      current.turnCount += s.turnCount;
      modelMap.set(s.primaryModel, current);
    });
    
    const models = Array.from(modelMap.values());
    const totalCost = models.reduce((sum, m) => sum + m.totalCostUsd, 0);
    
    return models.map(m => ({
      ...m,
      percentage: totalCost > 0 ? (m.totalCostUsd / totalCost) * 100 : 0,
    })).sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  })();
  
  $: topModel = filteredModelBreakdown.reduce((top, m) => {
    if (!top || m.totalCostUsd > top.totalCostUsd) return m;
    return top;
  }, null as typeof filteredModelBreakdown[0] | null);
  
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
</style>
