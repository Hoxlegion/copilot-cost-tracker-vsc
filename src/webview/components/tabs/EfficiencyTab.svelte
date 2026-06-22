<script lang="ts">
  import { dashboardData, formatUsd } from '../../stores/dashboard';
  import { filteredSessions } from '../../stores/filteredSessions';
  import { filterState } from '../../stores/filter';
  import StatCard from '../shared/StatCard.svelte';
  import BudgetBar from '../shared/BudgetBar.svelte';
  import DataTable from '../shared/DataTable.svelte';
  import SurfacePieChart from '../charts/SurfacePieChart.svelte';
  import ContextScatterChart from '../charts/ContextScatterChart.svelte';
  import ContextGrowthChart from '../charts/ContextGrowthChart.svelte';
  import { formatCompactNumber, formatTokens, formatSessionLabel } from '../../utils/format';
  import { friendlyAgentName } from '../../utils/agentLabels';
  
  $: data = $dashboardData;
  $: sessions = $filteredSessions;
  $: dailyAgentBreakdown = data?.dailyAgentBreakdown ?? [];
  $: allDistribution = data?.contextDistribution ?? [];
  $: titleMap = new Map((data?.allSessions ?? []).filter(s => s.title).map(s => [s.sessionId, s.title!]));
  
  // ── Insight metrics (computed from filtered sessions) ──
  $: totalInput = sessions.reduce((sum, s) => sum + s.totalInputTokens, 0);
  $: totalCached = sessions.reduce((sum, s) => sum + s.totalCachedTokens, 0);
  $: totalOutput = sessions.reduce((sum, s) => sum + s.totalOutputTokens, 0);
  $: totalTurns = sessions.reduce((sum, s) => sum + s.turnCount, 0);
  $: billableInput = totalInput + totalCached;
  $: cacheHitPct = billableInput > 0 ? (totalCached / billableInput) * 100 : 0;
  $: ioRatio = totalOutput > 0 ? Math.round(billableInput / totalOutput) : 0;
  $: avgInputPerTurnK = totalTurns > 0 ? Math.round((billableInput / totalTurns) / 100) / 10 : 0;
  
  // ── Optimization score ──
  $: optimizationScore = (() => {
    let score = 0;
    // Cache (40 weight): 70%+ = full, <40% = 0
    const cacheScore = cacheHitPct >= 70 ? 40 : cacheHitPct >= 40 ? (cacheHitPct - 40) / 30 * 40 : 0;
    score += cacheScore;
    // Context (30 weight): avg < 5K = full, >40K = 0
    const avgCtx = contextDistribution.length > 0
      ? contextDistribution.reduce((s, d) => s + d.currentContextWeight, 0) / contextDistribution.length
      : 0;
    const ctxScore = avgCtx <= 5000 ? 30 : avgCtx <= 20000 ? 30 * (1 - (avgCtx - 5000) / 15000) : avgCtx <= 40000 ? 30 * 0.2 * (1 - (avgCtx - 20000) / 20000) : 0;
    score += ctxScore;
    // I:O (30 weight): <5 = full, >10 = 0  
    const ioScore = ioRatio <= 5 ? 30 : ioRatio <= 10 ? 30 * (1 - (ioRatio - 5) / 5) : 0;
    score += ioScore;
    return Math.round(score);
  })();
  
  $: scoreColor = optimizationScore >= 70 ? '#81c784' : optimizationScore >= 40 ? '#ffb74d' : '#e57373';
  $: cacheHitColor = cacheHitPct >= 70 ? '#81c784' : cacheHitPct >= 40 ? '#ffb74d' : '#e57373';
  
  // ── Alerts ──
  $: filteredAlerts = (() => {
    const alerts: Array<{id: string; severity: 'info' | 'warning' | 'critical'; title: string; message: string; tip: string; metric: {label: string; value: string}}> = [];
    const avgOutputPerTurn = totalTurns > 0 ? totalOutput / totalTurns : 0;
    const maxSessionInput = sessions.reduce((max, s) => Math.max(max, s.totalInputTokens + s.totalCachedTokens), 0);
    
    if (avgOutputPerTurn > 600 && totalTurns >= 5) {
      alerts.push({
        id: 'high_verbosity', severity: 'warning',
        title: 'High Output Verbosity',
        message: `Averaging ${Math.round(avgOutputPerTurn).toLocaleString()} output tokens per turn.`,
        tip: 'Try "Skip explanations, code only" to cut output tokens by up to 65%.',
        metric: { label: 'Avg output / turn', value: `${Math.round(avgOutputPerTurn).toLocaleString()} tokens` },
      });
    }
    if (maxSessionInput > 40000) {
      const label = maxSessionInput >= 1000000 ? `${(maxSessionInput / 1000000).toFixed(1)}M tokens` : `${(maxSessionInput / 1000).toFixed(1)}K tokens`;
      alerts.push({
        id: 'context_bloat', severity: 'warning',
        title: 'Stale Context',
        message: `A session has accumulated ${label} of input.`,
        tip: 'Run /compact or start a fresh chat.',
        metric: { label: 'Peak session input', value: label },
      });
    }
    if (cacheHitPct < 40 && billableInput > 5000) {
      alerts.push({
        id: 'cache_decay', severity: 'info',
        title: 'Low Cache Hit',
        message: `Cache hit rate is ${cacheHitPct.toFixed(1)}%.`,
        tip: 'Keep related tasks in one session to improve reuse.',
        metric: { label: 'Cache hit rate', value: `${cacheHitPct.toFixed(1)}%` },
      });
    }
    if (maxSessionInput > 80000) {
      const label = maxSessionInput >= 1000000 ? `${(maxSessionInput / 1000000).toFixed(1)}M` : `${(maxSessionInput / 1000).toFixed(1)}K`;
      alerts.push({
        id: 'massive_context', severity: 'critical',
        title: 'Massive Context',
        message: `A session has ${label} tokens of total input.`,
        tip: "Constrain your agent's scope with explicit boundaries.",
        metric: { label: 'Peak total input', value: `${label} tokens` },
      });
    }
    return alerts;
  })();
  
  // ── Playbook ──
  $: filteredPlaybook = (() => {
    const avgOutputPerTurn = totalTurns > 0 ? totalOutput / totalTurns : 0;
    const maxSessionInput = sessions.reduce((max, s) => Math.max(max, s.totalInputTokens + s.totalCachedTokens), 0);
    
    const isVerbose = avgOutputPerTurn > 600 && totalTurns >= 5;
    const isBloated = maxSessionInput > 40000;
    const isLeaking = cacheHitPct < 40 && billableInput > 5000;
    const isPingPong = avgInputPerTurnK > 20 && totalTurns >= 5;
    const isSprawling = maxSessionInput > 80000;
    
    function row(strategy: string, isAlert: boolean, green: string, warn: string, metric: string, impact: string) {
      return { strategy, statusEmoji: isAlert ? '🔴' : '🟢', statusLabel: isAlert ? warn : green, metricDesc: metric, impact };
    }
    return [
      row('Output Brevity', isVerbose, 'Concise', 'Verbose',
        isVerbose ? `Avg ${Math.round(avgOutputPerTurn).toLocaleString()} output tokens/turn` : 'Normal range', 'Up to 65% reduction'),
      row('Context Hygiene', isBloated, 'Clean', 'Bloated',
        isBloated ? `Session hit ${(maxSessionInput / 1000).toFixed(1)}K tokens` : 'Healthy', 'Prevents exponential scaling'),
      row('Cache Efficiency', isLeaking, 'Optimal', 'Leaking',
        `Cache hit rate ${cacheHitPct.toFixed(1)}%`, '10x cheaper reads'),
      row('Prompt Batching', isPingPong, 'Good', 'High input/turn',
        isPingPong ? `${avgInputPerTurnK.toFixed(1)}K avg input/turn` : 'Normal', 'Reduces resend overhead'),
      row('Agent Scoping', isSprawling, 'Scoped', 'Sprawling',
        isSprawling ? `${(maxSessionInput / 1000).toFixed(1)}K peak input` : 'No massive sessions', 'Eliminates wasted scans'),
    ];
  })();
  
  // ── Agent breakdown for surface chart ──
  $: filteredAgentBreakdown = (() => {
    const agentMap = new Map<string, { agentName: string; totalCostUsd: number; totalCredits: number; turnCount: number }>();
    dailyAgentBreakdown.forEach(day => {
      const dayTs = new Date(day.period + 'T00:00:00').getTime();
      const dayEndTs = dayTs + 86400000 - 1;
      if ($filterState.fromMs !== null && dayEndTs < $filterState.fromMs) return;
      if ($filterState.toMs !== null && dayTs > $filterState.toMs) return;
      const current = agentMap.get(day.agentName) ?? { agentName: day.agentName, totalCostUsd: 0, totalCredits: 0, turnCount: 0 };
      current.totalCostUsd += day.totalCostUsd;
      current.totalCredits += day.totalCredits;
      current.turnCount += day.turnCount;
      agentMap.set(day.agentName, current);
    });
    const agents = Array.from(agentMap.values());
    const total = agents.reduce((s, a) => s + a.totalCostUsd, 0);
    return agents.map(a => ({
      ...a,
      percentage: total > 0 ? (a.totalCostUsd / total) * 100 : 0,
    })).sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  })();
  
  // ── Surface cost view ──
  $: surfaceCostView = (() => {
    const totalCost = filteredAgentBreakdown.reduce((s, a) => s + a.totalCostUsd, 0);
    return filteredAgentBreakdown.filter(a => a.totalCostUsd > 0).map(a => ({
      surface: friendlyAgentName(a.agentName),
      pct: totalCost > 0 ? (a.totalCostUsd / totalCost) * 100 : 0,
      cost: a.totalCostUsd, credits: a.totalCredits, turns: a.turnCount,
    }));
  })();

  const surfaceColumns = [
    { key: 'surface', label: 'Surface', type: 'string' as const, primary: true },
    { key: 'pct', label: '%', type: 'number' as const, muted: true },
    { key: 'cost', label: 'Cost', type: 'number' as const, highlight: true },
    { key: 'credits', label: 'Credits', type: 'number' as const },
    { key: 'turns', label: 'Turns', type: 'number' as const },
  ];
  $: surfaceRows = surfaceCostView.map(s => ({
    surface: s.surface, pct: s.pct.toFixed(1), cost: $formatUsd(s.cost), credits: s.credits.toFixed(1), turns: s.turns,
  }));
  
  // ── Cache savings ──
  $: cacheSavingsValue = (() => {
    // Real per-cached-token savings (input rate − cached rate) from actual billing,
    // applied to the cached tokens in the current range.
    const cs = data?.cacheSavings;
    if (!cs || cs.totalCacheReadTokens <= 0 || cs.totalSavingsCostUsd <= 0) return 0;
    const savingsPerCachedToken = cs.totalSavingsCostUsd / cs.totalCacheReadTokens;
    const rangeCachedTokens = sessions.reduce((sum, s) => sum + s.totalCachedTokens, 0);
    return rangeCachedTokens * savingsPerCachedToken;
  })();
  $: cacheSavingsPct = (() => {
    const rangeCost = sessions.reduce((sum, s) => sum + s.totalCostUsd, 0);
    if (rangeCost === 0) return 0;
    return (cacheSavingsValue / (rangeCost + cacheSavingsValue)) * 100;
  })();
  
  // ── Context data (absorbed from ContextTab) ──
  $: contextDistribution = allDistribution.filter(d => {
    if ($filterState.fromMs !== null && d.startMs < $filterState.fromMs) return false;
    if ($filterState.toMs !== null && d.startMs > $filterState.toMs) return false;
    return true;
  });
  $: filteredSessionIds = new Set(contextDistribution.map(d => d.sessionId));
  $: filteredTimelines = (data?.contextTimelines ?? []).filter(t => filteredSessionIds.has(t.sessionId));
  
  $: avgContext = contextDistribution.length > 0
    ? contextDistribution.reduce((sum, d) => sum + d.currentContextWeight, 0) / contextDistribution.length : 0;
  $: heavySessionsCount = contextDistribution.filter(d => d.currentContextWeight > 20000).length;
  $: peakContext = contextDistribution.length > 0 ? contextDistribution[0].currentContextWeight : 0;
  
  function tierLabel(tokens: number): string {
    if (tokens <= 5000) return 'Light';
    if (tokens <= 20000) return 'Moderate';
    if (tokens <= 40000) return 'Heavy';
    return 'Critical';
  }
  
  function formatPages(tokens: number): string {
    const pages = Math.round(tokens / 2500);
    if (pages <= 0) return '< 1 page';
    if (pages === 1) return '~1 page';
    return `~${pages} pages`;
  }
  
  $: avgContextColor = avgContext > 20000 ? '#e57373' : avgContext > 5000 ? '#ffb74d' : '#81c784';
  
  const ctxTableColumns = [
    { key: 'session', label: 'Session', type: 'string' as const, primary: true },
    { key: 'turns', label: 'Turns', type: 'number' as const },
    { key: 'context', label: 'Context', type: 'string' as const, highlight: true },
    { key: 'health', label: 'Health', type: 'string' as const },
    { key: 'cost', label: 'Cost', type: 'number' as const },
  ];
  $: ctxTableRows = contextDistribution.slice(0, 10).map(d => ({
    session: formatSessionLabel(d.workspace, d.startMs, d.sessionId, titleMap.get(d.sessionId)),
    turns: d.turnCount,
    context: formatTokens(d.currentContextWeight),
    health: tierLabel(d.currentContextWeight),
    cost: $formatUsd(d.totalCost),
  }));
  
  // ── Estimates (absorbed) ──
  $: insightMetrics = data?.insightMetrics;
  $: monthCostUsd = data?.monthTotal.costUsd ?? 0;
  $: costPerOutputK = (() => {
    if (!insightMetrics || insightMetrics.totalOutputTokens < 1000) return '—';
    return $formatUsd(monthCostUsd / (insightMetrics.totalOutputTokens / 1000));
  })();
  $: inputOverheadPct = (() => {
    if (!insightMetrics) return '0';
    const ti = insightMetrics.totalInputTokens + insightMetrics.totalCachedTokens;
    const ta = ti + insightMetrics.totalOutputTokens;
    return ta > 0 ? Math.round((ti / ta) * 100).toString() : '0';
  })();
  
  let showPlaybook = false;
</script>

<div class="efficiency-tab">
  <!-- Optimization score bar -->
  <div class="score-section">
    <div class="score-bar-container">
      <div class="score-bar" style="width: {optimizationScore}%; background: {scoreColor};"></div>
    </div>
    <div class="score-header">
      <span class="score-value" style="color: {scoreColor}">{optimizationScore}/100</span>
      <span class="score-label">Optimization Score</span>
    </div>
    <div class="score-indicators">
      <span>Cache: <span style="color: {cacheHitColor}">{cacheHitPct.toFixed(0)}%</span></span>
      <span>Context: <span style="color: {avgContextColor}">{tierLabel(avgContext)}</span></span>
      <span>I:O: <span style="color: {ioRatio <= 8 ? '#81c784' : '#ffb74d'}">{ioRatio}:1</span></span>
    </div>
  </div>
  
  <!-- Alerts + Playbook toggle -->
  <div class="alerts-section">
    <div class="alerts-header">
      <h3>Alerts & Playbook</h3>
      <button class="toggle-btn" on:click={() => showPlaybook = !showPlaybook}>
        {showPlaybook ? 'Show Alerts' : 'Show Playbook'}
      </button>
    </div>
    
    {#if !showPlaybook}
      {#if filteredAlerts.length > 0}
        <div class="alert-cards">
          {#each filteredAlerts as alert}
            <div class="alert-card alert-{alert.severity}">
              <div class="alert-top">
                <strong>{alert.title}</strong>
                <span class="alert-metric">{alert.metric.label}: <strong>{alert.metric.value}</strong></span>
              </div>
              <div class="alert-message">{alert.message}</div>
              <div class="alert-tip-box"><strong>Tip:</strong> {alert.tip}</div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="no-alerts">✅ No active alerts — usage looks efficient.</div>
      {/if}
    {:else}
      <table class="playbook-table">
        <thead><tr><th>Strategy</th><th>Status</th><th>Metric</th><th>Impact</th></tr></thead>
        <tbody>
          {#each filteredPlaybook as row}
            <tr>
              <td><strong>{row.strategy}</strong></td>
              <td>{row.statusEmoji} {row.statusLabel}</td>
              <td class="muted">{row.metricDesc}</td>
              <td class="muted">{row.impact}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
  
  <!-- Two-column: Cache analysis + Context scatter -->
  <div class="analysis-grid">
    <div class="analysis-panel">
      <h4>Cache Analysis</h4>
      <div class="cache-stat-row">
        <StatCard 
          label="Cache Hit Rate"
          value="{cacheHitPct.toFixed(1)}%"
          sub="{formatCompactNumber(totalCached)} cached of {formatCompactNumber(billableInput)} input"
          valueColor={cacheHitColor}
        >
          <BudgetBar percentage={cacheHitPct} color={cacheHitColor} />
        </StatCard>
        <StatCard
          label="Cache Savings"
          value={cacheSavingsValue > 0 ? $formatUsd(cacheSavingsValue) : '—'}
          sub={cacheSavingsValue > 0 ? `${cacheSavingsPct.toFixed(1)}% of spend` : ''}
          valueColor="#81c784"
        />
      </div>
    </div>
    
    <div class="analysis-panel">
      <h4>Context Health</h4>
      <div class="cache-stat-row">
        <StatCard 
          label="Avg Context"
          value={formatTokens(avgContext)}
          sub="{formatPages(avgContext)}"
          valueColor={avgContextColor}
        />
        <StatCard 
          label="Heavy Sessions"
          value={heavySessionsCount}
          sub=">20K tokens"
          valueColor={heavySessionsCount > 0 ? '#ffb74d' : '#81c784'}
        />
      </div>
    </div>
  </div>
  
  <!-- Charts row -->
  <div class="charts-grid">
    <div class="chart-panel">
      <h4>Spend by Action Type</h4>
      <SurfacePieChart />
    </div>
    <div class="chart-panel">
      <h4>Context Distribution</h4>
      <ContextScatterChart />
    </div>
  </div>
  
  {#if filteredTimelines.length > 0}
    <div class="growth-section">
      <h4>Context Growth (Top 5 Heaviest)</h4>
      <ContextGrowthChart />
    </div>
  {/if}
  
  {#if surfaceCostView.length > 0}
    <div class="table-section">
      <h4>Action Type Breakdown</h4>
      <DataTable columns={surfaceColumns} rows={surfaceRows} />
    </div>
  {/if}
  
  {#if contextDistribution.length > 0}
    <div class="table-section">
      <h4>Heaviest Sessions</h4>
      <DataTable columns={ctxTableColumns} rows={ctxTableRows} />
    </div>
  {/if}
  
  <!-- Estimates reference (collapsible) -->
  <details class="estimates-section">
    <summary>Cost Estimation Reference</summary>
    <div class="estimates-content">
      <div class="est-stats">
        <div class="est-stat">
          <span class="est-label">Cost per Output-K</span>
          <span class="est-value">{costPerOutputK}</span>
        </div>
        <div class="est-stat">
          <span class="est-label">Input Overhead</span>
          <span class="est-value">{inputOverheadPct}%</span>
        </div>
      </div>
      <p class="est-note">
        <strong>⚠ Speculative:</strong> Based on token counts. Not tracked: acceptance rate, retained LOC, copy/insert events.
      </p>
    </div>
  </details>
</div>

<style>
  .efficiency-tab { padding: 0; }
  
  /* ── Score bar ── */
  .score-section {
    background: color-mix(in srgb, var(--vscode-editorWidget-background) 72%, #103449 28%);
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, #2aa5ff 40%);
    border-radius: 12px;
    padding: 16px 20px;
    margin-bottom: 14px;
  }
  
  .score-bar-container {
    width: 100%;
    height: 10px;
    background: var(--vscode-panel-border);
    border-radius: 5px;
    overflow: hidden;
    margin-bottom: 10px;
  }
  
  .score-bar {
    height: 100%;
    border-radius: 5px;
    transition: width 0.5s ease;
  }
  
  .score-header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 6px;
  }
  
  .score-value {
    font-size: 24px;
    font-weight: 800;
  }
  
  .score-label {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  
  .score-indicators {
    display: flex;
    gap: 20px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  
  .score-indicators span span {
    font-weight: 600;
  }
  
  /* ── Alerts ── */
  .alerts-section {
    margin-bottom: 14px;
  }
  
  .alerts-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  
  .alerts-header h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .toggle-btn {
    padding: 4px 12px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-button-border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
  }
  .toggle-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
  
  .alert-cards { display: flex; flex-direction: column; gap: 8px; }
  .alert-card {
    padding: 10px 14px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-left: 3px solid;
    border-radius: 6px;
  }
  .alert-info { border-left-color: #4fc3f7; }
  .alert-warning { border-left-color: #ffb74d; }
  .alert-critical { border-left-color: #e57373; }
  
  .alert-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 4px;
  }
  .alert-top strong { font-size: 12px; }
  .alert-metric { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .alert-message { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
  .alert-tip-box {
    font-size: 11px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 6px 8px;
  }
  .no-alerts {
    padding: 10px 12px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  
  /* Playbook table */
  .playbook-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .playbook-table th, .playbook-table td { padding: 8px; text-align: left; border-bottom: 1px solid var(--vscode-panel-border); }
  .playbook-table th { font-weight: 600; color: var(--vscode-descriptionForeground); }
  .playbook-table .muted { color: var(--vscode-descriptionForeground); }
  
  /* ── Analysis grid ── */
  .analysis-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 14px;
  }
  
  .analysis-panel {
    background: color-mix(in srgb, var(--vscode-editorWidget-background) 78%, #103449 22%);
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, #2aa5ff 30%);
    border-radius: 10px;
    padding: 14px 16px;
  }
  
  .analysis-panel h4 {
    margin: 0 0 10px 0;
    font-size: 12px;
    font-weight: 700;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .cache-stat-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  
  /* ── Charts ── */
  .charts-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 14px;
  }
  
  .chart-panel h4 {
    margin: 0 0 8px 0;
    font-size: 12px;
    font-weight: 700;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .growth-section {
    margin-bottom: 14px;
  }
  .growth-section h4 {
    margin: 0 0 8px 0;
    font-size: 12px;
    font-weight: 700;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .table-section {
    margin-bottom: 14px;
  }
  .table-section h4 {
    margin: 0 0 8px 0;
    font-size: 12px;
    font-weight: 700;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  /* ── Estimates ── */
  .estimates-section {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 8px;
    margin-top: 8px;
  }
  
  .estimates-section summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 12px;
    padding: 10px 14px;
    color: var(--vscode-descriptionForeground);
    user-select: none;
  }
  
  .estimates-content {
    padding: 0 14px 14px;
  }
  
  .est-stats {
    display: flex;
    gap: 24px;
    margin-bottom: 10px;
  }
  
  .est-stat {
    display: flex;
    flex-direction: column;
  }
  
  .est-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .est-value {
    font-size: 18px;
    font-weight: 700;
  }
  
  .est-note {
    margin: 0;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
</style>
