export function renderTokensTab(): string {
  return `
  <div class="tab-content" id="tab-tokens">
    <div class="stat-row">
      <div class="stat">
        <div class="stat-label">Total Input Tokens (Range)</div>
        <div class="stat-value" id="tokensTotalInput">0</div>
        <div class="stat-sub" id="tokensTotalInputSub">net + cached input</div>
      </div>
      <div class="stat">
        <div class="stat-label">Cached Input Tokens (Range)</div>
        <div class="stat-value" id="tokensTotalCached">0</div>
        <div class="stat-sub" id="tokensTotalCachedSub">cache hit 0.0%</div>
      </div>
      <div class="stat">
        <div class="stat-label">Output Tokens (Range)</div>
        <div class="stat-value" id="tokensTotalOutput">0</div>
        <div class="stat-sub" id="tokensTotalOutputSub">I:O ratio —:1</div>
      </div>
      <div class="stat">
        <div class="stat-label">Avg Tokens / Turn (Range)</div>
        <div class="stat-value" id="tokensAvgPerTurn">0</div>
        <div class="stat-sub" id="tokensAvgPerTurnSub">0 turns in range</div>
      </div>
      <div class="stat">
        <div class="stat-label">Top Cost Model (Range)</div>
        <div class="stat-value" id="tokensTopModel">N/A</div>
        <div class="stat-sub" id="tokensTopModelSub">$0.00 (0.0%)</div>
      </div>
    </div>
    <h3 style="margin:12px 0 8px;font-size:13px;">Cost per Model per Turn</h3>
    <table>
      <thead>
        <tr>
          <th class="sortable" data-sort="model">Model</th>
          <th class="num sortable" data-sort="turns">Turns</th>
          <th class="num sortable" data-sort="totalCost">Total Cost</th>
          <th class="num sortable" data-sort="avgCost">Avg/Turn</th>
          <th class="num sortable" data-sort="avgCredits">Credits/Turn</th>
        </tr>
        <tr class="table-filter-row">
          <th><input id="tokensFilterModel" placeholder="Filter model"></th>
          <th><input id="tokensFilterTurns" placeholder="Filter turns"></th>
          <th><input id="tokensFilterCost" placeholder="Filter cost"></th>
          <th><input id="tokensFilterAvgCost" placeholder="Filter avg/turn"></th>
          <th><input id="tokensFilterAvgCredits" placeholder="Filter cr/turn"></th>
        </tr>
      </thead>
      <tbody id="tokensBody"></tbody>
    </table>
  </div>`;
}
