import type { DashboardViewData } from "./index";

export function renderDashboardHeader(v: DashboardViewData): string {
  return `
  <div class="header">
    <h1>Copilot Cost Tracker</h1>
    <div class="stats">
      <span>Today: <span class="val">$${v.today.costUsd.toFixed(2)}</span></span>
      <span>Week: <span class="val">$${v.week.costUsd.toFixed(2)}</span></span>
      <span>Month: <span class="val">$${v.monthTotal.costUsd.toFixed(2)}</span></span>
      <span>Budget: <span class="val">${v.usagePct}%</span></span>
      <span>In: <span class="val" id="headerTokenIn">0</span></span>
      <span>Out: <span class="val" id="headerTokenOut">0</span></span>
      <span>Cache: <span class="val" id="headerTokenCache">0%</span></span>
    </div>
  </div>

  <div class="tabs">
    <div class="tab active" data-tab="overview">Overview</div>
    <div class="tab" data-tab="budget">Spending</div>
    <div class="tab" data-tab="sessions">Sessions</div>
    <div class="tab" data-tab="models">Models</div>
    <div class="tab" data-tab="tokens">Tokens</div>
    <div class="tab" data-tab="insights">Insights</div>
    <div class="tab" data-tab="estimates">Estimates ⚠</div>
  </div>

  <div class="global-filter-bar">
    <span class="label">Global Range:</span>
    <button class="preset" data-preset="today">Today</button>
    <button class="preset" data-preset="7d">7d</button>
    <button class="preset" data-preset="30d">30d</button>
    <button class="preset active" data-preset="period">This Period</button>
    <span class="label">From</span>
    <input type="datetime-local" id="globalFrom">
    <span class="label">To</span>
    <input type="datetime-local" id="globalTo">
    <button class="action apply" id="globalApply">Apply</button>
    <button class="action reset" id="globalReset">Reset</button>
    <span id="globalRangeSummary" class="label"></span>
    <span class="freshness-chip" title="Last ingested turn timestamp">Updated: ${v.freshnessLabel}</span>
  </div>

  ${v.unknownModelBannerHtml}`;
}
