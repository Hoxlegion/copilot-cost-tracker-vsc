export function getUsagePresentation(periodCredits: number, budgetCredits: number): { usagePct: string } {
  const usagePct = budgetCredits > 0 ? ((periodCredits / budgetCredits) * 100).toFixed(1) : "0";
  return { usagePct };
}

export function getBudgetDetails(
  periodStartMs: number,
  periodEndMs: number,
  periodTurns: number,
  periodCredits: number,
  budgetCredits: number,
): {
  daysRemaining: number;
  dailyBudgetRemaining: string;
  burnRate: number;
  projectedPeriodCredits: number;
  forecastVisible: boolean;
  forecastOverage: number;
} {
  const daysRemaining = Math.max(0, Math.ceil((periodEndMs - Date.now()) / (24 * 60 * 60 * 1000)));
  const dailyBudgetRemaining = daysRemaining > 0 ? ((budgetCredits - periodCredits) / daysRemaining).toFixed(1) : "0";
  const msInDay = 24 * 60 * 60 * 1000;
  const totalDaysInPeriod = Math.max(1, Math.ceil((periodEndMs - periodStartMs) / msInDay));
  const daysSincePeriodStart = Math.max(1, Math.ceil((Date.now() - periodStartMs) / msInDay));
  const burnRate = periodCredits / daysSincePeriodStart;
  const projectedPeriodCredits = burnRate * totalDaysInPeriod;
  const forecastVisible = periodTurns >= 50 || periodCredits >= 0.5;
  const forecastOverage = projectedPeriodCredits - budgetCredits;
  return { daysRemaining, dailyBudgetRemaining, burnRate, projectedPeriodCredits, forecastVisible, forecastOverage };
}

export function getBudgetColor(percentage: number): string {
  if (percentage > 90) return "var(--vscode-errorForeground)";
  if (percentage > 75) return "var(--vscode-editorWarning-foreground)";
  return "var(--accent)";
}

export function getForecastHtml(
  forecastVisible: boolean,
  projectedCredits: number,
  burnRate: number,
  overage: number,
): string {
  if (!forecastVisible) {
    return `
      <div class="stat-value">-</div>
      <div class="stat-sub">Forecast available once more usage data is collected</div>
      <div class="stat-sub">(>= 50 turns or >= 0.50 credits)</div>`;
  }

  const overageHtml = overage > 0
    ? `<div class="stat-sub" style="color:var(--vscode-errorForeground)">+${overage.toFixed(1)} cr over budget</div>`
    : `<div class="stat-sub">${Math.abs(overage).toFixed(1)} cr under budget</div>`;

  return `
    <div class="stat-value">${projectedCredits.toFixed(1)} cr</div>
    <div class="stat-sub">Burn rate: ${burnRate.toFixed(2)} cr/day</div>
    ${overageHtml}`;
}
