<script lang="ts">
  import { dashboardData, formatUsd } from '../../stores/dashboard';
  import { filteredSessions } from '../../stores/filteredSessions';
  import { filterState } from '../../stores/filter';
  import DataTable from '../shared/DataTable.svelte';
  import Heatmap from '../charts/Heatmap.svelte';
  import type { DashboardRawData, TurnDiscoveryRow } from '../../types';
  import { formatCompactNumber } from '../../utils/format';

  type SessionEntry = DashboardRawData['allSessions'][number];
  
  let activePane: 'summary' | 'table' | 'discovery' = 'summary';
  let discoveryOnlyTools = false;
  let discoveryOnlyAnomalies = false;
  let discoveryExpandAll = false;
  let selectedWorkspace: string | null = null;
  
  $: data = $dashboardData;
  $: allSessions = data?.allSessions ?? [];
  $: turnDiscovery = data?.turnDiscovery ?? [];
  $: sessions = $filteredSessions;
  
  // Workspace filter
  $: workspaces = (() => {
    const map = new Map<string, number>();
    sessions.forEach(s => map.set(s.workspace, (map.get(s.workspace) ?? 0) + s.totalCostUsd));
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  })();
  
  $: filteredByWorkspace = selectedWorkspace 
    ? sessions.filter(s => s.workspace === selectedWorkspace)
    : sessions;
  
  // Workspace summary 
  $: workspaceSummary = (() => {
    const workspaceMap = new Map<string, {
      workspace: string; costUsd: number; credits: number; sessions: number; turns: number;
    }>();
    filteredByWorkspace.forEach(s => {
      const current = workspaceMap.get(s.workspace) ?? {
        workspace: s.workspace, costUsd: 0, credits: 0, sessions: 0, turns: 0,
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
  
  $: recentSessions = [...filteredByWorkspace]
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp)
    .slice(0, 8);
  
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
  
  $: sessionRows = filteredByWorkspace.map(s => {
    const date = new Date(s.startTimestamp).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const cacheBase = s.totalInputTokens + s.totalCachedTokens;
    const cachePct = cacheBase > 0 ? (s.totalCachedTokens / cacheBase) * 100 : 0;
    const totalTokens = s.totalInputTokens + s.totalOutputTokens + s.totalCachedTokens;
    return {
      id: s.sessionId,
      date: s.title ? `${s.title} · ${date}` : date,
      model: s.primaryModel,
      turns: s.turnCount,
      cost: $formatUsd(s.totalCostUsd),
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
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
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
</script>

<div class="activity-tab">
  <!-- Heatmap at top -->
  <Heatmap />
  
  <!-- Workspace filter chips -->
  {#if workspaces.length > 1}
    <div class="workspace-chips">
      <button 
        class="chip" 
        class:active={selectedWorkspace === null}
        on:click={() => selectedWorkspace = null}
      >All</button>
      {#each workspaces as ws}
        <button 
          class="chip"
          class:active={selectedWorkspace === ws}
          on:click={() => selectedWorkspace = selectedWorkspace === ws ? null : ws}
          title={ws}
        >{ws.length > 22 ? ws.slice(0, 19) + '…' : ws}</button>
      {/each}
    </div>
  {/if}
  
  <!-- Sub-pane toggle -->
  <div class="pane-tabs">
    <button class:active={activePane === 'summary'} on:click={() => activePane = 'summary'}>Summary</button>
    <button class:active={activePane === 'table'} on:click={() => activePane = 'table'}>Table</button>
    <button class:active={activePane === 'discovery'} on:click={() => activePane = 'discovery'}>Turn Explorer</button>
  </div>
  
  {#if activePane === 'summary'}
    <div class="summary-pane">
      <!-- Recent sessions as cards -->
      <h3 class="sub-title">Recent Sessions</h3>
      <div class="session-cards">
        {#each recentSessions as s}
          {@const cacheBase = s.totalInputTokens + s.totalCachedTokens}
          {@const cacheHitPct = cacheBase > 0 ? (s.totalCachedTokens / cacheBase) * 100 : 0}
          {@const timeLabel = new Date(s.lastTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {@const isExpensive = s.totalCostUsd > 50}
          <div class="session-card" class:expensive={isExpensive}>
            <div class="sc-header">
              <span class="sc-time">{timeLabel}</span>
              <span class="sc-workspace" title={s.workspace}>{s.workspace}</span>
              {#if s.title}
                <span class="sc-title" title={s.title}>{s.title}</span>
              {/if}
            </div>
            <div class="sc-body">
              <span class="sc-model">{s.primaryModel}</span>
              <span class="sc-sep">·</span>
              <span>{s.turnCount} turns</span>
              <span class="sc-sep">·</span>
              <span>{cacheHitPct.toFixed(0)}% cache</span>
              <span class="sc-sep">·</span>
              <span class="sc-cost" class:highlight={isExpensive}>{$formatUsd(s.totalCostUsd)}</span>
            </div>
          </div>
        {/each}
      </div>
      
      {#if workspaceSummary.length > 1}
        <h3 class="sub-title">Workspace Focus</h3>
        <table class="ws-table">
          <thead>
            <tr>
              <th>Workspace</th>
              <th class="num">Cost</th>
              <th class="num">Credits</th>
              <th class="num">Sessions</th>
              <th class="num">Turns</th>
            </tr>
          </thead>
          <tbody>
            {#each workspaceSummary as ws}
              <tr>
                <td title={ws.workspace}>{ws.workspace}</td>
                <td class="num">{$formatUsd(ws.costUsd)}</td>
                <td class="num">{ws.credits.toFixed(1)}</td>
                <td class="num">{ws.sessions}</td>
                <td class="num">{ws.turns}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
    
  {:else if activePane === 'table'}
    <div class="table-pane">
      <div class="section-header">
        <p class="session-count">{filteredByWorkspace.length} sessions{selectedWorkspace ? ` in ${selectedWorkspace}` : ''}</p>
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
                <thead><tr><th>Model</th><th class="num">Turns</th><th class="num">Cost</th><th class="num">Credits</th><th class="num">Tokens</th><th class="num">Cache%</th></tr></thead>
                <tbody>
                  {#each (row._raw as SessionEntry).modelBreakdown as model}
                    {@const modelTotalTokens = model.totalInputTokens + model.totalOutputTokens + model.totalCachedTokens}
                    {@const modelCachePct = (model.totalInputTokens + model.totalCachedTokens) > 0 
                      ? (model.totalCachedTokens / (model.totalInputTokens + model.totalCachedTokens)) * 100 : 0}
                    <tr>
                      <td>{model.model}</td>
                      <td class="num">{model.turnCount}</td>
                      <td class="num">{$formatUsd(model.totalCostUsd)}</td>
                      <td class="num">{model.totalCredits.toFixed(1)}</td>
                      <td class="num">{formatCompactNumber(modelTotalTokens)}</td>
                      <td class="num">{modelCachePct.toFixed(1)}%</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {:else}
              <p class="no-data">No per-model breakdown available.</p>
            {/if}
          </div>
        </div>
      </DataTable>
    </div>
    
  {:else if activePane === 'discovery'}
    <div class="discovery-pane">
      <div class="discovery-controls">
        <button on:click={() => discoveryExpandAll = true}>Expand all</button>
        <button on:click={() => discoveryExpandAll = false}>Collapse all</button>
        <label><input type="checkbox" bind:checked={discoveryOnlyTools} /> Only rows with tools</label>
        <label><input type="checkbox" bind:checked={discoveryOnlyAnomalies} /> Only anomalies</label>
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
              <div class="discovery-cards">
                <div class="card-group">
                  <span class="card-label">Models</span>
                  <div class="card-row">
                    {#if (row._raw as TurnDiscoveryRow).models.length > 0}
                      {#each (row._raw as TurnDiscoveryRow).models as model}
                        <span class="pill model-pill">{model}</span>
                      {/each}
                    {:else}<span class="pill-empty">unknown</span>{/if}
                  </div>
                </div>
                <div class="card-group">
                  <span class="card-label">Agents</span>
                  <div class="card-row">
                    {#if (row._raw as TurnDiscoveryRow).agents.length > 0}
                      {#each (row._raw as TurnDiscoveryRow).agents as agent}
                        <span class="pill agent-pill">{agent}</span>
                      {/each}
                    {:else}<span class="pill-empty">unknown</span>{/if}
                  </div>
                </div>
                <div class="card-group">
                  <span class="card-label">Tools</span>
                  <div class="card-row">
                    {#if (row._raw as TurnDiscoveryRow).tools.length > 0}
                      {#each (row._raw as TurnDiscoveryRow).tools as tool}
                        <span class="pill tool-pill">{tool}</span>
                      {/each}
                    {:else}<span class="pill-empty">none</span>{/if}
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
  .activity-tab {
    padding: 0;
  }
  
  /* ── Workspace chips ── */
  .workspace-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 14px 0;
    padding: 10px 14px;
    background: color-mix(in srgb, var(--vscode-editorWidget-background) 78%, #103449 22%);
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, #2aa5ff 30%);
    border-radius: 8px;
  }
  
  .chip {
    padding: 4px 12px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-button-border);
    border-radius: 14px;
    cursor: pointer;
    font-size: 11px;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  
  .chip:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  
  .chip.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: var(--vscode-button-background);
  }
  
  /* ── Pane tabs ── */
  .pane-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 14px;
    border-bottom: 1px solid var(--vscode-panel-border);
    padding-bottom: 8px;
  }
  
  .pane-tabs button {
    padding: 6px 16px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-button-border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  
  .pane-tabs button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .pane-tabs button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  
  /* ── Session cards ── */
  .sub-title {
    margin: 0 0 10px 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--vscode-editor-foreground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .session-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 8px;
    margin-bottom: 20px;
  }
  
  .session-card {
    background: color-mix(in srgb, var(--vscode-editorWidget-background) 78%, #103449 22%);
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, #2aa5ff 30%);
    border-radius: 8px;
    padding: 10px 14px;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }
  
  .session-card:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  
  .session-card.expensive {
    border-left: 3px solid #e57373;
  }
  
  .sc-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    flex-wrap: wrap;
  }
  
  .sc-time {
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
  }
  
  .sc-workspace {
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-editor-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 180px;
  }
  
  .sc-title {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 150px;
  }
  
  .sc-body {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    flex-wrap: wrap;
  }
  
  .sc-model {
    color: #4fc3f7;
    font-weight: 500;
  }
  
  .sc-sep {
    opacity: 0.3;
  }
  
  .sc-cost {
    font-weight: 600;
    color: var(--vscode-editor-foreground);
  }
  
  .sc-cost.highlight {
    color: #e57373;
  }
  
  /* ── Tables ── */
  .ws-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  
  .ws-table th, .ws-table td {
    padding: 6px 8px;
    text-align: left;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  
  .ws-table th { font-weight: 600; color: var(--vscode-descriptionForeground); }
  .ws-table th.num, .ws-table td.num { text-align: right; }
  
  .section-header { margin-bottom: 8px; }
  .session-count { margin: 0; font-size: 11px; color: var(--vscode-descriptionForeground); }
  
  .expand-content { padding: 8px 0; }
  .expand-content h4 {
    margin: 0 0 8px 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .expand-content table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .expand-content th, .expand-content td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--vscode-panel-border); }
  .expand-content th { font-weight: 600; color: var(--vscode-descriptionForeground); }
  .expand-content th.num, .expand-content td.num { text-align: right; }
  .no-data { margin: 0; font-size: 12px; color: var(--vscode-descriptionForeground); }
  
  /* ── Discovery ── */
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
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
  }
  .discovery-controls button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .discovery-controls label {
    display: flex; align-items: center; gap: 6px;
    font-size: 11px; color: var(--vscode-descriptionForeground); cursor: pointer;
  }
  
  .discovery-details { padding: 8px 0; }
  .discovery-cards { display: flex; flex-direction: column; gap: 8px; }
  .card-group { display: flex; flex-direction: column; gap: 4px; }
  .card-label { font-size: 10px; font-weight: 600; color: var(--vscode-descriptionForeground); text-transform: uppercase; }
  .card-row { display: flex; flex-wrap: wrap; gap: 4px; }
  
  .pill {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
  }
  .model-pill { background: rgba(79, 195, 247, 0.15); color: #4fc3f7; }
  .agent-pill { background: rgba(186, 104, 200, 0.15); color: #ba68c8; }
  .tool-pill { background: rgba(255, 183, 77, 0.15); color: #ffb74d; }
  .pill-empty { font-size: 11px; color: var(--vscode-descriptionForeground); }
</style>
