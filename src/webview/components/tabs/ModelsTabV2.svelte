<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filteredSessions } from '../../stores/filteredSessions';
  import { filterState } from '../../stores/filter';
  import StatCard from '../shared/StatCard.svelte';
  import DataTable from '../shared/DataTable.svelte';
  import ModelBarChart from '../charts/ModelBarChart.svelte';
  import ModelPieChart from '../charts/ModelPieChart.svelte';
  import TokenTrendChart from '../charts/TokenTrendChart.svelte';
  import { formatCompactNumber } from '../../utils/format';
  import { friendlyAgentName } from '../../utils/agentLabels';
  
  $: data = $dashboardData;
  $: sessions = $filteredSessions;
  $: dailyAgentBreakdown = data?.dailyAgentBreakdown ?? [];
  
  // ── Token stats (absorbed from TokensTab) ──
  $: totalInput = sessions.reduce((sum, s) => sum + s.totalInputTokens, 0);
  $: totalCached = sessions.reduce((sum, s) => sum + s.totalCachedTokens, 0);
  $: totalOutput = sessions.reduce((sum, s) => sum + s.totalOutputTokens, 0);
  $: totalTurns = sessions.reduce((sum, s) => sum + s.turnCount, 0);
  $: billableInput = totalInput + totalCached;
  $: cacheHitPct = billableInput > 0 ? (totalCached / billableInput) * 100 : 0;
  $: ioRatio = totalOutput > 0 ? Math.round(billableInput / totalOutput) : 0;
  
  // ── Model breakdown ──
  $: filteredModelBreakdown = (() => {
    const modelMap = new Map<string, {
      model: string; totalCostUsd: number; totalCredits: number; turnCount: number;
      totalInputTokens: number; totalOutputTokens: number; totalCachedTokens: number;
    }>();
    sessions.forEach(s => {
      const current = modelMap.get(s.primaryModel) ?? {
        model: s.primaryModel, totalCostUsd: 0, totalCredits: 0, turnCount: 0,
        totalInputTokens: 0, totalOutputTokens: 0, totalCachedTokens: 0,
      };
      current.totalCostUsd += s.totalCostUsd;
      current.totalCredits += s.totalCredits;
      current.turnCount += s.turnCount;
      current.totalInputTokens += s.totalInputTokens;
      current.totalOutputTokens += s.totalOutputTokens;
      current.totalCachedTokens += s.totalCachedTokens;
      modelMap.set(s.primaryModel, current);
    });
    const models = Array.from(modelMap.values());
    const totalCost = models.reduce((sum, m) => sum + m.totalCostUsd, 0);
    return models.map(m => ({
      ...m,
      percentage: totalCost > 0 ? (m.totalCostUsd / totalCost) * 100 : 0,
    })).sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  })();
  
  // ── Agent breakdown ──
  $: filteredAgentBreakdown = (() => {
    const agentMap = new Map<string, {
      agentName: string; totalCostUsd: number; totalCredits: number; turnCount: number;
    }>();
    dailyAgentBreakdown.forEach(day => {
      const dayTs = new Date(day.period + 'T00:00:00').getTime();
      const dayEndTs = dayTs + 86400000 - 1;
      if ($filterState.fromMs !== null && dayEndTs < $filterState.fromMs) return;
      if ($filterState.toMs !== null && dayTs > $filterState.toMs) return;
      const current = agentMap.get(day.agentName) ?? {
        agentName: day.agentName, totalCostUsd: 0, totalCredits: 0, turnCount: 0,
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
  
  const modelColumns = [
    { key: 'model', label: 'Model', type: 'string' as const, primary: true },
    { key: 'turns', label: 'Turns', type: 'number' as const },
    { key: 'cost', label: 'Cost (USD)', type: 'number' as const, highlight: true },
    { key: 'avgCost', label: 'Avg Cost/Turn', type: 'number' as const, muted: true },
    { key: 'pct', label: '%', type: 'number' as const, muted: true },
    { key: 'tokens', label: 'Tokens', type: 'number' as const, muted: true },
    { key: 'cachePct', label: 'Cache Hit', type: 'percentage' as const },
    { key: 'avgMs', label: 'Avg (ms)', type: 'number' as const, muted: true },
    { key: 'tailMs', label: 'Tail (ms)', type: 'number' as const, muted: true },
  ];
  
  $: modelRows = filteredModelBreakdown.map(m => {
    const totalTokens = m.totalInputTokens + m.totalOutputTokens + m.totalCachedTokens;
    const cacheBase = m.totalInputTokens + m.totalCachedTokens;
    const mCachePct = cacheBase > 0 ? (m.totalCachedTokens / cacheBase) * 100 : 0;
    const avgCost = m.turnCount > 0 ? m.totalCostUsd / m.turnCount : 0;
    const sessionDurations = sessions
      .filter(s => s.primaryModel === m.model)
      .map(s => s.avgDurationMs)
      .filter(d => d > 0)
      .sort((a, b) => a - b);
    const avgMs = sessionDurations.length > 0
      ? Math.round(sessionDurations.reduce((sum, d) => sum + d, 0) / sessionDurations.length)
      : 0;
    const tailMs = sessionDurations.length >= 20
      ? sessionDurations[Math.floor(sessionDurations.length * 0.9)]
      : sessionDurations.length >= 5
        ? sessionDurations[Math.floor(sessionDurations.length * 0.5)]
        : 0;
    return {
      model: m.model,
      turns: m.turnCount,
      cost: m.totalCostUsd.toFixed(2),
      avgCost: `$${avgCost.toFixed(4)}`,
      pct: m.percentage.toFixed(1),
      tokens: totalTokens.toLocaleString(),
      cachePct: mCachePct.toFixed(1),
      avgMs: avgMs > 0 ? avgMs : '-',
      tailMs: tailMs > 0 ? Math.round(tailMs) : '-',
    };
  });
  
  const agentColumns = [
    { key: 'agent', label: 'Agent', type: 'string' as const, primary: true },
    { key: 'turns', label: 'Turns', type: 'number' as const },
    { key: 'credits', label: 'Credits', type: 'number' as const },
    { key: 'cost', label: 'Cost (USD)', type: 'number' as const, highlight: true },
    { key: 'pct', label: '%', type: 'number' as const, muted: true },
  ];
  
  $: agentRows = filteredAgentBreakdown.slice(0, 12).map(a => ({
    agent: friendlyAgentName(a.agentName),
    turns: a.turnCount,
    credits: a.totalCredits.toFixed(1),
    cost: a.totalCostUsd.toFixed(2),
    pct: a.percentage.toFixed(1),
  }));
</script>

<div class="models-tab">
  <!-- Token stat cards row -->
  <div class="stat-row">
    <StatCard
      label="Models Active"
      value={filteredModelBreakdown.length}
      sub="in range"
    />
    <StatCard
      label="Total Tokens"
      value={formatCompactNumber(billableInput + totalOutput)}
      sub="{formatCompactNumber(billableInput)} in · {formatCompactNumber(totalOutput)} out"
    />
    <StatCard
      label="Cache Hit"
      value="{cacheHitPct.toFixed(1)}%"
      sub="{formatCompactNumber(totalCached)} cached tokens"
      valueColor={cacheHitPct >= 70 ? '#81c784' : cacheHitPct >= 40 ? '#ffb74d' : '#e57373'}
    />
    <StatCard
      label="I:O Ratio"
      value="{totalOutput > 0 ? `${ioRatio}:1` : '—'}"
      sub="{totalTurns} turns in range"
    />
  </div>
  
  <!-- Charts grid -->
  <div class="charts-grid">
    <ModelBarChart />
    <ModelPieChart />
  </div>
  
  <!-- Token flow chart (moved from Insights) -->
  <div class="token-flow-section">
    <h3>Token Flow</h3>
    <TokenTrendChart />
  </div>
  
  <!-- Model table -->
  <div class="tables-section">
    <DataTable columns={modelColumns} rows={modelRows} />
    
    {#if agentRows.length > 0}
      <div class="agents-section">
        <h3>Agents (Current Range)</h3>
        <DataTable columns={agentColumns} rows={agentRows} />
      </div>
    {/if}
  </div>
</div>

<style>
  .models-tab {
    padding: 0;
  }
  
  .stat-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }
  
  .charts-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 14px;
  }
  
  .token-flow-section {
    margin-bottom: 14px;
  }
  
  .token-flow-section h3 {
    margin: 0 0 8px 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--vscode-editor-foreground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .tables-section {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  
  .agents-section h3 {
    margin: 0 0 10px 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--vscode-editor-foreground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
</style>
