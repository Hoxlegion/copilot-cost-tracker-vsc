import { getBudgetColor, getForecastHtml } from "../helpers";
import type { DashboardViewData } from "./index";

export function renderBudgetTab(v: DashboardViewData): string {
  return `
  <div class="tab-content" id="tab-budget">
    <div class="stat-row">
      <div class="stat">
        <div class="stat-label" id="budgetUsedLabel">Range Used</div>
        <div class="stat-value" id="budgetUsageValue">${v.usagePct}%</div>
        <div class="stat-sub" id="budgetUsageSub">${v.periodCredits.toFixed(0)} / ${v.budgetCredits} cr</div>
        <div class="budget-bar"><div class="budget-fill" id="budgetUsageFill" style="width:${Math.min(100, Number.parseFloat(v.usagePct))}%;background:${getBudgetColor(Number.parseFloat(v.usagePct))}"></div></div>
      </div>
      <div class="stat">
        <div class="stat-label">Days Remaining</div>
        <div class="stat-value">${v.daysRemaining}</div>
        <div class="stat-sub">~${v.dailyBudgetRemaining} cr/day budget</div>
      </div>
      <div class="stat">
        <div class="stat-label" id="budgetRemainingLabel">Remaining Credits</div>
        <div class="stat-value" id="budgetRemainingValue">${(v.budgetCredits - v.periodCredits).toFixed(0)}</div>
        <div class="stat-sub" id="budgetRemainingSub">of ${v.budgetCredits} total</div>
      </div>
      <div class="stat">
        <div class="stat-label">Forecast (Period End)</div>
        ${getForecastHtml(v.forecastVisible, v.projectedPeriodCredits, v.burnRate, v.forecastOverage)}
      </div>
      <div class="stat">
        <div class="stat-label">Token Density (Range)</div>
        <div class="stat-value" id="budgetTokenDensity">0</div>
        <div class="stat-sub" id="budgetTokenDensitySub">tokens per credit</div>
      </div>
    </div>
    <h3 style="margin:12px 0 8px;font-size:12px;text-transform:uppercase;color:var(--muted)" id="budgetModelTitle">Model Breakdown (Current Range)</h3>
    <table>
      <thead><tr><th>Model</th><th class="num">Turns</th><th class="num">Credits</th><th class="num">%</th></tr></thead>
      <tbody id="budgetModelsBody"></tbody>
    </table>
  </div>`;
}
