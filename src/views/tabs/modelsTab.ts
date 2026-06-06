export function renderModelsTab(): string {
  return `
  <div class="tab-content" id="tab-models">
    <div class="chart-grid">
      <div class="chart-wrap"><canvas id="modelBarChart"></canvas></div>
      <div class="chart-wrap"><canvas id="modelPieChart"></canvas></div>
    </div>
    <table>
      <thead>
        <tr>
          <th class="sortable" data-sort="model">Model</th>
          <th class="num sortable" data-sort="turns">Turns</th>
          <th class="num sortable" data-sort="cost">Cost (USD)</th>
          <th class="num sortable" data-sort="pct">%</th>
          <th class="num sortable" data-sort="totalTokens">Tokens</th>
          <th class="num sortable" data-sort="cachePct">Cache%</th>
          <th class="num sortable" data-sort="avgMs">Avg (ms)</th>
          <th class="num sortable" data-sort="tailMs">Tail (ms)</th>
        </tr>
        <tr class="table-filter-row">
          <th><input id="modelsFilterModel" placeholder="Filter model"></th>
          <th><input id="modelsFilterTurns" placeholder="Filter turns"></th>
          <th><input id="modelsFilterCost" placeholder="Filter cost"></th>
          <th><input id="modelsFilterPct" placeholder="Filter %"></th>
          <th><input id="modelsFilterTokens" placeholder="Filter tokens"></th>
          <th><input id="modelsFilterCachePct" placeholder="Filter cache%"></th>
          <th><input id="modelsFilterAvg" placeholder="Filter avg"></th>
          <th><input id="modelsFilterTail" placeholder="Filter tail"></th>
        </tr>
      </thead>
      <tbody id="modelsBody"></tbody>
    </table>
    <h3 id="modelsAgentsTitle" style="margin:16px 0 8px;font-size:12px;text-transform:uppercase;color:var(--muted)">Agents (Current Range, by Cost)</h3>
    <table>
      <thead><tr><th>Agent</th><th class="num">Turns</th><th class="num">Credits</th><th class="num">Cost (USD)</th><th class="num">%</th></tr></thead>
      <tbody id="modelsAgentsBody"></tbody>
    </table>
  </div>`;
}
