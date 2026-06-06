import type { DashboardViewData } from "./index";

export function renderSessionsTab(v: DashboardViewData): string {
  return `
  <div class="tab-content" id="tab-sessions">
    <div class="session-subtabs">
      <button class="session-subtab active" data-sessions-pane="summary">Summary</button>
      <button class="session-subtab" data-sessions-pane="table">Table</button>
      <button class="session-subtab" data-sessions-pane="discovery">Discovery</button>
    </div>
    <div class="session-pane active" id="sessions-pane-summary">
      <div class="session-zone">
        <div class="section-header">
          <div class="section-title">Session Operations</div>
          <div class="section-sub" id="sessionCount"></div>
        </div>
        <div class="session-focus-grid">
          <div class="insight-panel" style="margin-top:0">
            <h4>Workspace Focus (Current Range)</h4>
            <div class="insight-note">See which workspaces cost the most so you can plan targeted optimizations.</div>
            <table style="font-size:12px">
              <thead><tr><th>Workspace</th><th class="num">Cost</th><th class="num">Credits</th><th class="num">Sessions</th><th class="num">LLM Calls</th></tr></thead>
              <tbody>${v.workspaceSummaryView.workspaceRowsHtml}</tbody>
            </table>
          </div>
          <div class="insight-panel" style="margin-top:0">
            <h4>Recent Session Snapshots</h4>
            <div class="insight-note">Quick session snapshots with model, volume, cache efficiency and cost in a compact overview.</div>
            <table style="font-size:12px">
              <thead><tr><th>Last Active</th><th>Workspace</th><th>Session</th><th>Primary Model</th><th class="num">LLM Calls</th><th class="num">Cache Hit</th><th class="num">Cost</th></tr></thead>
              <tbody>${v.recentSessionRowsHtml}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    <div class="session-pane" id="sessions-pane-table">
      <div class="session-zone">
        <div class="section-header">
          <div class="section-title">Session Table</div>
          <div class="section-sub">Detailed per-session view with expandable model breakdown</div>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:28px"></th>
              <th class="sortable" data-sort="ts">Date</th>
              <th class="sortable" data-sort="model">Model</th>
              <th class="num sortable" data-sort="turns">Turns</th>
              <th class="num sortable" data-sort="costUsd">Cost</th>
              <th class="num sortable" data-sort="credits">Credits</th>
              <th class="num sortable" data-sort="totalTokens">Tokens</th>
              <th class="num sortable" data-sort="cachePct">Cache%</th>
              <th class="num sortable" data-sort="avgLatencyMs">Avg Latency (ms)</th>
            </tr>
            <tr class="table-filter-row">
              <th></th>
              <th><input id="sessionsFilterDate" placeholder="Filter date"></th>
              <th><input id="sessionsFilterModel" placeholder="Filter model"></th>
              <th><input id="sessionsFilterTurns" placeholder="Filter turns"></th>
              <th><input id="sessionsFilterCost" placeholder="Filter cost"></th>
              <th><input id="sessionsFilterCredits" placeholder="Filter credits"></th>
              <th><input id="sessionsFilterTokens" placeholder="Filter tokens"></th>
              <th><input id="sessionsFilterCachePct" placeholder="Filter cache%"></th>
              <th><input id="sessionsFilterLatency" placeholder="Filter latency"></th>
            </tr>
          </thead>
          <tbody id="sessionsBody"></tbody>
        </table>
      </div>
    </div>
    <div class="session-pane" id="sessions-pane-discovery">
      <div class="session-zone" style="margin-bottom:0">
        <div class="section-header">
          <div class="section-title">Turn Discovery</div>
          <div class="section-sub">Inspect per-turn LLM/tool calls and anomalies, linked directly to sessions</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <button id="discoveryExpandAll" style="font-size:11px;border:1px solid var(--border);border-radius:4px;padding:3px 8px;background:var(--card-bg);color:var(--fg);cursor:pointer">Expand all</button>
          <button id="discoveryCollapseAll" style="font-size:11px;border:1px solid var(--border);border-radius:4px;padding:3px 8px;background:var(--card-bg);color:var(--fg);cursor:pointer">Collapse all</button>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)">
            <input id="discoveryOnlyTools" type="checkbox"> Only rows with tools
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)">
            <input id="discoveryOnlyAnomalies" type="checkbox"> Only anomalies
          </label>
        </div>
        <table style="font-size:12px">
          <thead><tr><th></th><th class="sortable" data-sort="turnIndex">Turn</th><th>Session</th><th class="num sortable" data-sort="llmCalls">LLM</th><th class="num sortable" data-sort="toolCalls">Tools</th><th class="num sortable" data-sort="inputTotal">Input</th><th class="num sortable" data-sort="outputTokens">Output</th><th class="num sortable" data-sort="cacheHitPct">Cache%</th></tr></thead>
          <tbody id="discoveryBody"></tbody>
        </table>
      </div>
    </div>
  </div>`;
}
