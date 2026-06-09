<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import DataTable from '../shared/DataTable.svelte';
  import type { DashboardRawData, TurnDiscoveryRow } from '../../types';

  type SessionEntry = DashboardRawData['allSessions'][number];
  
  let activePane: 'summary' | 'table' | 'discovery' = 'summary';
  let discoveryOnlyTools = false;
  let discoveryOnlyAnomalies = false;
  let discoveryExpandAll = false;
  
  $: data = $dashboardData;
  $: allSessions = data?.allSessions ?? [];
  $: turnDiscovery = data?.turnDiscovery ?? [];
  
  $: filteredSessions = allSessions.filter(s => {
    if ($filterState.fromMs !== null && s.startTimestamp < $filterState.fromMs) return false;
    if ($filterState.toMs !== null && s.startTimestamp > $filterState.toMs) return false;
    return true;
  });
  
  $: workspaceSummary = (() => {
    const workspaceMap = new Map<string, {
      workspace: string;
      costUsd: number;
      credits: number;
      sessions: number;
      turns: number;
    }>();
    
    filteredSessions.forEach(s => {
      const current = workspaceMap.get(s.workspace) ?? {
        workspace: s.workspace,
        costUsd: 0,
        credits: 0,
        sessions: 0,
        turns: 0,
      };
      current.costUsd += s.totalCostUsd;
      current.credits += s.totalCredits;
      current.sessions += 1;
      current.turns += s.turnCount;
      workspaceMap.set(s.workspace, current);
    });
    
    return Array.from(workspaceMap.values())
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 6);
  })();
  
  $: recentSessions = [...filteredSessions]
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp)
    .slice(0, 6);
  
  const sessionColumns = [
    { key: 'date', label: 'Date', type: 'string' as const, primary: true },
    { key: 'model', label: 'Model', type: 'string' as const, muted: true },
    { key: 'turns', label: 'Turns', type: 'number' as const },
    { key: 'cost', label: 'Cost', type: 'number' as const, highlight: true },
    { key: 'credits', label: 'Credits', type: 'number' as const },
    { key: 'tokens', label: 'Tokens', type: 'number' as const, muted: true },
    { key: 'cachePct', label: 'Cache Hit', type: 'percentage' as const },
    { key: 'avgLatency', label: 'Avg Latency', type: 'number' as const, muted: true },
  ];
  
  $: sessionRows = filteredSessions.map(s => {
    const date = new Date(s.startTimestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const cacheBase = s.totalInputTokens + s.totalCachedTokens;
    const cachePct = cacheBase > 0 ? (s.totalCachedTokens / cacheBase) * 100 : 0;
    const totalTokens = s.totalInputTokens + s.totalOutputTokens + s.totalCachedTokens;
    
    return {
      id: s.sessionId,
      date,
      model: s.primaryModel,
      turns: s.turnCount,
      cost: s.totalCostUsd.toFixed(2),
      credits: s.totalCredits.toFixed(1),
      tokens: totalTokens.toLocaleString(),
      cachePct: cachePct.toFixed(1),
      avgLatency: Math.round(s.avgDurationMs),
      _raw: s,
    };
  });
  
  $: filteredDiscovery = turnDiscovery
    .filter(r => {
      const ts = r.lastTimeMs || r.firstTimeMs || 0;
      if ($filterState.fromMs !== null && ts < $filterState.fromMs) return false;
      if ($filterState.toMs !== null && ts > $filterState.toMs) return false;
      return true;
    })
    .filter(r => !discoveryOnlyTools || r.toolCalls > 0)
    .filter(r => !discoveryOnlyAnomalies || (r.cacheHitPct < 40 || r.toolCalls > 0))
    .slice(0, 120);
  
  const discoveryColumns = [
    { key: 'lastActive', label: 'Last Active', type: 'string' as const, primary: true },
    { key: 'turn', label: 'Turn', type: 'number' as const },
    { key: 'session', label: 'Session', type: 'string' as const, muted: true },
    { key: 'llmCalls', label: 'LLM', type: 'number' as const },
    { key: 'toolCalls', label: 'Tools', type: 'number' as const },
    { key: 'input', label: 'Input', type: 'number' as const, muted: true },
    { key: 'output', label: 'Output', type: 'number' as const, muted: true },
    { key: 'cachePct', label: 'Cache Hit', type: 'percentage' as const },
  ];
  
  $: discoveryRows = filteredDiscovery.map(r => {
    const lastActive = new Date(r.lastTimeMs).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    
    return {
      id: `${r.chatSessionId}::${r.turnIndex}`,
      lastActive,
      turn: r.turnIndex + 1,
      session: r.chatSessionId.length > 12 
        ? `${r.chatSessionId.slice(0, 6)}…${r.chatSessionId.slice(-4)}`
        : r.chatSessionId,
      llmCalls: r.llmCalls,
      toolCalls: r.toolCalls,
      input: (r.inputTokens + r.cachedTokens).toLocaleString(),
      output: r.outputTokens.toLocaleString(),
      cachePct: r.cacheHitPct.toFixed(1),
      _raw: r,
    };
  });
  
  function formatCompactNumber(value: number): string {
    if (!Number.isFinite(value)) return '0';
    if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(1) + 'M';
    if (Math.abs(value) >= 1000) return (value / 1000).toFixed(1) + 'K';
    return String(Math.round(value));
  }
</script>

<div class="sessions-tab">
  <div class="pane-tabs">
    <button 
      class:active={activePane === 'summary'}
      on:click={() => activePane = 'summary'}
    >
      Summary
    </button>
    <button 
      class:active={activePane === 'table'}
      on:click={() => activePane = 'table'}
    >
      Table
    </button>
    <button 
      class:active={activePane === 'discovery'}
      on:click={() => activePane = 'discovery'}
    >
      Discovery
    </button>
  </div>
  
  {#if activePane === 'summary'}
    <div class="summary-pane">
      <div class="summary-grid">
        <div class="summary-section">
          <h3>Workspace Focus (Current Range)</h3>
          <p class="summary-note">See which workspaces cost the most so you can plan targeted optimizations.</p>
          <table>
            <thead>
              <tr>
                <th>Workspace</th>
                <th class="num">Cost</th>
                <th class="num">Credits</th>
                <th class="num">Sessions</th>
                <th class="num">LLM Calls</th>
              </tr>
            </thead>
            <tbody>
              {#each workspaceSummary as ws}
                <tr>
                  <td title={ws.workspace}>{ws.workspace}</td>
                  <td class="num">${ws.costUsd.toFixed(2)}</td>
                  <td class="num">{ws.credits.toFixed(1)}</td>
                  <td class="num">{ws.sessions}</td>
                  <td class="num">{ws.turns}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        
        <div class="summary-section">
          <h3>Recent Session Snapshots</h3>
          <p class="summary-note">Quick session snapshots with model, volume, cache efficiency and cost in a compact overview.</p>
          <table>
            <thead>
              <tr>
                <th>Last Active</th>
                <th>Workspace</th>
                <th>Session</th>
                <th>Primary Model</th>
                <th class="num">LLM Calls</th>
                <th class="num">Cache Hit</th>
                <th class="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {#each recentSessions as s}
                {@const cacheBase = s.totalInputTokens + s.totalCachedTokens}
                {@const cacheHitPct = cacheBase > 0 ? (s.totalCachedTokens / cacheBase) * 100 : 0}
                {@const timeLabel = new Date(s.lastTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                <tr>
                  <td>{timeLabel}</td>
                  <td title={s.workspace}>{s.workspace}</td>
                  <td title={s.sessionId}>
                    {s.sessionId.length > 12 
                      ? `${s.sessionId.slice(0, 6)}…${s.sessionId.slice(-4)}`
                      : s.sessionId}
                  </td>
                  <td>{s.primaryModel}</td>
                  <td class="num">{s.turnCount}</td>
                  <td class="num">{cacheHitPct.toFixed(1)}%</td>
                  <td class="num">${s.totalCostUsd.toFixed(2)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  {:else if activePane === 'table'}
    <div class="table-pane">
      <div class="section-header">
        <h3>Session Table</h3>
        <p class="section-sub">Detailed per-session view with expandable model breakdown</p>
        <p class="session-count">{filteredSessions.length} of {allSessions.length} sessions</p>
      </div>
      
      <DataTable 
        columns={sessionColumns}
        rows={sessionRows}
        expandable={true}
        rowId={(row) => String(row.id)}
      >
        <div slot="expand" let:row>
          <div class="expand-content">
            <h4>Per-model breakdown</h4>
            {#if (row._raw as SessionEntry).modelBreakdown && (row._raw as SessionEntry).modelBreakdown.length > 0}
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th class="num">Turns</th>
                    <th class="num">Cost</th>
                    <th class="num">Credits</th>
                    <th class="num">Tokens</th>
                    <th class="num">Cache%</th>
                  </tr>
                </thead>
                <tbody>
                  {#each (row._raw as SessionEntry).modelBreakdown as model}
                    {@const modelTotalTokens = model.totalInputTokens + model.totalOutputTokens + model.totalCachedTokens}
                    {@const modelCachePct = (model.totalInputTokens + model.totalCachedTokens) > 0 
                      ? (model.totalCachedTokens / (model.totalInputTokens + model.totalCachedTokens)) * 100 
                      : 0}
                    <tr>
                      <td>{model.model}</td>
                      <td class="num">{model.turnCount}</td>
                      <td class="num">${model.totalCostUsd.toFixed(2)}</td>
                      <td class="num">{model.totalCredits.toFixed(1)}</td>
                      <td class="num">{formatCompactNumber(modelTotalTokens)}</td>
                      <td class="num">{modelCachePct.toFixed(1)}%</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {:else}
              <p class="no-data">No per-model breakdown is available for this session.</p>
            {/if}
          </div>
        </div>
      </DataTable>
    </div>
  {:else if activePane === 'discovery'}
    <div class="discovery-pane">
      <div class="section-header">
        <h3>Turn Discovery</h3>
        <p class="section-sub">Inspect per-turn LLM/tool calls and anomalies, linked directly to sessions</p>
      </div>
      
      <div class="discovery-controls">
        <button on:click={() => discoveryExpandAll = true}>Expand all</button>
        <button on:click={() => discoveryExpandAll = false}>Collapse all</button>
        <label>
          <input type="checkbox" bind:checked={discoveryOnlyTools} />
          Only rows with tools
        </label>
        <label>
          <input type="checkbox" bind:checked={discoveryOnlyAnomalies} />
          Only anomalies
        </label>
      </div>
      
      <DataTable 
        columns={discoveryColumns}
        rows={discoveryRows}
        expandable={true}
        expandAll={discoveryExpandAll}
        rowId={(row) => String(row.id)}
      >
        <div slot="expand" let:row>
          <div class="expand-content">
            <div class="discovery-details">
              <div class="discovery-header">
                <span>Last active: {new Date((row._raw as TurnDiscoveryRow).lastTimeMs).toLocaleTimeString()}</span>
                <span>Session: {(row._raw as TurnDiscoveryRow).chatSessionId}</span>
              </div>
              <div class="discovery-cards">
                <div class="card-group">
                  <span class="card-label">Models</span>
                  <div class="card-row">
                    {#if (row._raw as TurnDiscoveryRow).models.length > 0}
                      {#each (row._raw as TurnDiscoveryRow).models as model}
                        <span class="card model-card">{model}</span>
                      {/each}
                    {:else}
                      <span class="card-empty">unknown</span>
                    {/if}
                  </div>
                </div>
                <div class="card-group">
                  <span class="card-label">Agents</span>
                  <div class="card-row">
                    {#if (row._raw as TurnDiscoveryRow).agents.length > 0}
                      {#each (row._raw as TurnDiscoveryRow).agents as agent}
                        <span class="card agent-card">{agent}</span>
                      {/each}
                    {:else}
                      <span class="card-empty">unknown</span>
                    {/if}
                  </div>
                </div>
                <div class="card-group">
                  <span class="card-label">Tools</span>
                  <div class="card-row">
                    {#if (row._raw as TurnDiscoveryRow).tools.length > 0}
                      {#each (row._raw as TurnDiscoveryRow).tools as tool}
                        <span class="card tool-card">{tool}</span>
                      {/each}
                    {:else}
                      <span class="card-empty">none</span>
                    {/if}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DataTable>
    </div>
  {/if}
</div>

<style>
  .sessions-tab {
    padding: 0;
  }
  
  .pane-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--vscode-panel-border);
    padding-bottom: 8px;
  }
  
  .pane-tabs button {
    padding: 6px 16px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-button-border);
    border-radius: 2px;
    cursor: pointer;
    font-size: 12px;
  }
  
  .pane-tabs button:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  
  .pane-tabs button.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  
  .summary-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  
  .summary-section {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 16px;
  }
  
  .summary-section h3 {
    margin: 0 0 8px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }
  
  .summary-note {
    margin: 0 0 12px 0;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  
  .summary-section table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  
  .summary-section th,
  .summary-section td {
    padding: 6px 8px;
    text-align: left;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  
  .summary-section th {
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
  }
  
  .summary-section th.num,
  .summary-section td.num {
    text-align: right;
  }
  
  .section-header {
    margin-bottom: 16px;
  }
  
  .section-header h3 {
    margin: 0 0 4px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }
  
  .section-sub {
    margin: 0;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  
  .session-count {
    margin: 4px 0 0 0;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  
  .expand-content {
    padding: 8px 0;
  }
  
  .expand-content h4 {
    margin: 0 0 12px 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .expand-content table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  
  .expand-content th,
  .expand-content td {
    padding: 6px 8px;
    text-align: left;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  
  .expand-content th {
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
  }
  
  .expand-content th.num,
  .expand-content td.num {
    text-align: right;
  }
  
  .no-data {
    margin: 0;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  
  .discovery-controls {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  
  .discovery-controls button {
    padding: 4px 12px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-button-border);
    border-radius: 2px;
    cursor: pointer;
    font-size: 11px;
  }
  
  .discovery-controls button:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  
  .discovery-controls label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
  }
  
  .discovery-details {
    padding: 8px 0;
  }
  
  .discovery-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 12px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  
  .discovery-cards {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  
  .card-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .card-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--vscode-descriptionForeground);
  }
  
  .card-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  
  .card {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.6;
  }
  
  .model-card {
    background: rgba(79, 195, 247, 0.12);
    color: #4fc3f7;
    border: 1px solid rgba(79, 195, 247, 0.25);
  }
  
  .agent-card {
    background: rgba(129, 199, 132, 0.12);
    color: #81c784;
    border: 1px solid rgba(129, 199, 132, 0.25);
  }
  
  .tool-card {
    background: rgba(255, 183, 77, 0.12);
    color: #ffb74d;
    border: 1px solid rgba(255, 183, 77, 0.25);
  }
  
  .card-empty {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.7;
    font-style: italic;
  }
</style>
