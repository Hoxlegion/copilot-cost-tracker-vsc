<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import StatCard from '../shared/StatCard.svelte';
  import DataTable from '../shared/DataTable.svelte';
  import ContextScatterChart from '../charts/ContextScatterChart.svelte';
  import ContextGrowthChart from '../charts/ContextGrowthChart.svelte';
  import { formatSessionLabel } from '../../utils/format';
  
  $: data = $dashboardData;
  $: allDistribution = data?.contextDistribution ?? [];
  $: titleMap = new Map((data?.allSessions ?? []).filter(s => s.title).map(s => [s.sessionId, s.title!]));
  
  $: contextDistribution = allDistribution.filter(d => {
    if ($filterState.fromMs !== null && d.startMs < $filterState.fromMs) return false;
    if ($filterState.toMs !== null && d.startMs > $filterState.toMs) return false;
    return true;
  });
  
  $: filteredSessionIds = new Set(contextDistribution.map(d => d.sessionId));
  
  $: filteredTimelines = (data?.contextTimelines ?? []).filter(t => filteredSessionIds.has(t.sessionId));
  
  $: avgContext = contextDistribution.length > 0
    ? contextDistribution.reduce((sum, d) => sum + d.currentContextWeight, 0) / contextDistribution.length
    : 0;
  
  $: heavySessionsCount = contextDistribution.filter(d => d.currentContextWeight > 20000).length;
  $: heavySessionsPct = contextDistribution.length > 0
    ? (heavySessionsCount / contextDistribution.length) * 100
    : 0;
  
  $: peakContext = contextDistribution.length > 0
    ? contextDistribution[0].currentContextWeight
    : 0;
  
  $: peakPages = Math.round(peakContext / 2500);
  
  $: contextWastePct = (() => {
    const timelines = filteredTimelines;
    if (timelines.length === 0) return 0;
    let totalWaste = 0;
    let count = 0;
    for (const tl of timelines) {
      if (tl.turns.length >= 2) {
        const first = tl.turns[0].currentContextWeight;
        const last = tl.turns[tl.turns.length - 1].currentContextWeight;
        if (last > 0) {
          totalWaste += (last - first) / last;
          count++;
        }
      }
    }
    return count > 0 ? (totalWaste / count) * 100 : 0;
  })();
  
  $: avgContextColor = avgContext > 20000 ? '#e57373' : avgContext > 5000 ? '#ffb74d' : '#81c784';
  $: heavyColor = heavySessionsPct > 30 ? '#e57373' : heavySessionsPct > 10 ? '#ffb74d' : '#81c784';
  $: peakColor = peakContext > 40000 ? '#e57373' : peakContext > 20000 ? '#ffb74d' : '#81c784';
  $: wasteColor = contextWastePct > 60 ? '#e57373' : contextWastePct > 30 ? '#ffb74d' : '#81c784';
  
  function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
    return `${tokens}`;
  }
  
  function formatPages(tokens: number): string {
    const pages = Math.round(tokens / 2500);
    if (pages <= 0) return '< 1 page';
    if (pages === 1) return '~1 page';
    return `~${pages} pages`;
  }
  
  function tierLabel(tokens: number): string {
    if (tokens <= 5000) return 'Light';
    if (tokens <= 20000) return 'Moderate';
    if (tokens <= 40000) return 'Heavy';
    return 'Critical';
  }
  
  function tierColor(tokens: number): string {
    if (tokens <= 5000) return '#81c784';
    if (tokens <= 20000) return '#ffb74d';
    if (tokens <= 40000) return '#ff8a65';
    return '#e57373';
  }
  
  const tableColumns = [
    { key: 'session', label: 'Session', type: 'string' as const, primary: true },
    { key: 'turns', label: 'Turns', type: 'number' as const },
    { key: 'context', label: 'Context', type: 'string' as const, highlight: true },
    { key: 'pages', label: 'Pages', type: 'string' as const, muted: true },
    { key: 'health', label: 'Health', type: 'string' as const },
    { key: 'cost', label: 'Cost', type: 'number' as const },
  ];
  
  $: tableRows = contextDistribution.slice(0, 20).map(d => ({
    session: formatSessionLabel(d.workspace, d.startMs, d.sessionId, titleMap.get(d.sessionId)),
    turns: d.turnCount,
    context: formatTokens(d.currentContextWeight),
    pages: formatPages(d.currentContextWeight),
    health: tierLabel(d.currentContextWeight),
    cost: `$${d.totalCost.toFixed(3)}`,
  }));
</script>

<div class="context-tab">
  <div class="stat-row">
    <StatCard 
      label="Avg Session Context"
      value={formatTokens(avgContext)}
      sub="{formatPages(avgContext)} · {avgContext > 20000 ? 'Consider fresh chats' : 'Healthy range'}"
      valueColor={avgContextColor}
    />
    
    <StatCard 
      label="Heavy Sessions"
      value="{heavySessionsCount}"
      sub="{heavySessionsPct.toFixed(0)}% of all sessions (>20K tokens)"
      valueColor={heavyColor}
    />
    
    <StatCard 
      label="Peak Context"
      value={formatTokens(peakContext)}
      sub="~{peakPages} pages · {tierLabel(peakContext)}"
      valueColor={peakColor}
    />
    
    <StatCard 
      label="Context Waste %"
      value="{contextWastePct.toFixed(0)}%"
      sub="Avg growth from first to last turn"
      valueColor={wasteColor}
    />
  </div>
  
  <div class="charts-grid">
    <div class="chart-section">
      <h4>Session Context Distribution</h4>
      <p class="chart-desc">Each dot is a session. X = turns, Y = context weight at last turn.</p>
      <ContextScatterChart />
    </div>
    
    <div class="chart-section">
      <h4>Context Growth Over Turns (Top 5 Heaviest)</h4>
      <p class="chart-desc">How context "snowballs" within a session as turns accumulate.</p>
      <ContextGrowthChart />
    </div>
  </div>
  
  {#if contextDistribution.length > 0}
    <div class="table-section">
      <h4>Heaviest Sessions</h4>
      <DataTable 
        columns={tableColumns}
        rows={tableRows}
      />
    </div>
  {/if}
  
  <div class="info-box">
    <strong>Why does context matter?</strong>
    <p>
      Every time you send a message in a chat, the AI re-reads the <em>entire</em> conversation history. 
      A 40K-token session means each new message costs as if you sent ~16 pages of text — even if your 
      question is just "fix the typo". Starting a fresh chat resets this to zero.
    </p>
  </div>
</div>

<style>
  .context-tab {
    padding: 0;
  }
  
  .stat-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-bottom: 20px;
  }
  
  .charts-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 20px;
  }
  
  .chart-section h4 {
    margin: 0 0 4px 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .chart-desc {
    margin: 0 0 8px 0;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.8;
  }
  
  .table-section {
    margin-bottom: 20px;
  }
  
  .table-section h4 {
    margin: 0 0 8px 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .info-box {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-left: 3px solid #4fc3f7;
    border-radius: 4px;
    padding: 12px 14px;
    font-size: 12px;
    line-height: 1.5;
  }
  
  .info-box strong {
    display: block;
    margin-bottom: 4px;
    font-size: 13px;
  }
  
  .info-box p {
    margin: 0;
    color: var(--vscode-descriptionForeground);
  }
</style>
