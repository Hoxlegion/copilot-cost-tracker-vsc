<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import DataTable from '../shared/DataTable.svelte';
  import ModelBarChart from '../charts/ModelBarChart.svelte';
  import ModelPieChart from '../charts/ModelPieChart.svelte';
  
  $: data = $dashboardData;
  $: allSessions = data?.allSessions ?? [];
  $: dailyAgentBreakdown = data?.dailyAgentBreakdown ?? [];
  
  $: filteredSessions = allSessions.filter(s => {
    if ($filterState.fromMs !== null && s.startTimestamp < $filterState.fromMs) return false;
    if ($filterState.toMs !== null && s.startTimestamp > $filterState.toMs) return false;
    return true;
  });
  
  $: filteredModelBreakdown = (() => {
    const modelMap = new Map<string, {
      model: string;
      totalCostUsd: number;
      totalCredits: number;
      turnCount: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalCachedTokens: number;
    }>();
    
    filteredSessions.forEach(s => {
      const current = modelMap.get(s.primaryModel) ?? {
        model: s.primaryModel,
        totalCostUsd: 0,
        totalCredits: 0,
        turnCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedTokens: 0,
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
  
  const modelColumns = [
    { key: 'model', label: 'Model', type: 'string' as const },
    { key: 'turns', label: 'Turns', type: 'number' as const },
    { key: 'cost', label: 'Cost (USD)', type: 'number' as const },
    { key: 'pct', label: '%', type: 'number' as const },
    { key: 'tokens', label: 'Tokens', type: 'number' as const },
    { key: 'cachePct', label: 'Cache%', type: 'number' as const },
    { key: 'avgMs', label: 'Avg (ms)', type: 'number' as const },
    { key: 'tailMs', label: 'Tail (ms)', type: 'number' as const },
  ];
  
  $: modelRows = filteredModelBreakdown.map(m => {
    const totalTokens = m.totalInputTokens + m.totalOutputTokens + m.totalCachedTokens;
    const cacheBase = m.totalInputTokens + m.totalCachedTokens;
    const cachePct = cacheBase > 0 ? (m.totalCachedTokens / cacheBase) * 100 : 0;
    
    const sessionDurations = filteredSessions
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
      pct: m.percentage.toFixed(1),
      tokens: totalTokens.toLocaleString(),
      cachePct: cachePct.toFixed(1),
      avgMs: avgMs > 0 ? avgMs : '-',
      tailMs: tailMs > 0 ? Math.round(tailMs) : '-',
    };
  });
  
  const agentColumns = [
    { key: 'agent', label: 'Agent', type: 'string' as const },
    { key: 'turns', label: 'Turns', type: 'number' as const },
    { key: 'credits', label: 'Credits', type: 'number' as const },
    { key: 'cost', label: 'Cost (USD)', type: 'number' as const },
    { key: 'pct', label: '%', type: 'number' as const },
  ];
  
  const AGENT_LABEL_MAP: Record<string, string> = {
    'GitHub Copilot Chat': 'Sidebar Chat',
    'panel/editAgent': 'Inline Chat',
    'XtabProvider': 'Next Edit Suggestions',
    'summarizeConversationHistory': 'Context Summarization',
    'progressMessages': 'Background Processing',
    'title': 'Title Generation',
  };
  
  $: agentRows = filteredAgentBreakdown.slice(0, 12).map(a => ({
    agent: AGENT_LABEL_MAP[a.agentName] ?? a.agentName ?? 'Other',
    turns: a.turnCount,
    credits: a.totalCredits.toFixed(1),
    cost: a.totalCostUsd.toFixed(2),
    pct: a.percentage.toFixed(1),
  }));
</script>

<div class="models-tab">
  <div class="charts-grid">
    <ModelBarChart />
    <ModelPieChart />
  </div>
  
  <div class="tables-section">
    <DataTable 
      columns={modelColumns}
      rows={modelRows}
    />
    
    <div class="agents-section">
      <h3>Agents (Current Range, by Cost)</h3>
      <DataTable 
        columns={agentColumns}
        rows={agentRows}
      />
    </div>
  </div>
</div>

<style>
  .models-tab {
    padding: 0;
  }
  
  .charts-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 24px;
  }
  
  .tables-section {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  
  .agents-section h3 {
    margin: 0 0 12px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }
</style>
