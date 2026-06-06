import { CostDatabase } from "../../database";
import type { UnknownModelDiagnostics } from "../../pricing";
import { percentile } from "./dashboardUtils";

export function computeModelLatencyRows(
  database: CostDatabase,
  days: number = 30,
): Array<{ model: string; avgMs: number; tailMs: number; tailLabel: string; tailHint: string }> {
  const samples = database.getModelLatencySamples(days);
  const grouped = new Map<string, number[]>();

  for (const sample of samples) {
    const values = grouped.get(sample.model) ?? [];
    values.push(sample.duration);
    grouped.set(sample.model, values);
  }

  const rows: Array<{ model: string; avgMs: number; tailMs: number; tailLabel: string; tailHint: string }> = [];
  for (const [model, values] of grouped.entries()) {
    values.sort((a, b) => a - b);
    const avgMs = Math.round(values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length));

    if (values.length < 5) {
      rows.push({ model, avgMs, tailMs: 0, tailLabel: "-", tailHint: "Tail metric hidden: requires at least 5 turns." });
    } else if (values.length < 20) {
      rows.push({ model, avgMs, tailMs: percentile(values, 0.5), tailLabel: "P50", tailHint: "P50 (median) shown due to low sample size (<20 turns)." });
    } else {
      rows.push({ model, avgMs, tailMs: percentile(values, 0.9), tailLabel: "P90", tailHint: "P90 shown (sample size >=20 turns)." });
    }
  }
  return rows;
}

export function buildModelPeriodData(
  database: CostDatabase,
  days: number,
): Array<{ model: string; cost: number; credits: number; turns: number; pct: number; avgMs: number; tailMs: number; tailLabel: string }> {
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const breakdown = database.getModelBreakdownSince(sinceMs);
  const latencyRows = computeModelLatencyRows(database, days);
  const latencyMap = new Map(latencyRows.map((r) => [r.model, r]));
  return breakdown.map((m) => {
    const lat = latencyMap.get(m.model) ?? { avgMs: 0, tailMs: 0, tailLabel: "-" };
    return { model: m.model, cost: m.totalCostUsd, credits: m.totalCredits, turns: m.turnCount, pct: m.percentage, avgMs: lat.avgMs, tailMs: lat.tailMs, tailLabel: lat.tailLabel };
  });
}

export function buildHeatmapData(dailyCosts: Array<{ period: string; totalCostUsd: number; turnCount: number }>): string {
  const now = new Date();
  const days: Array<{ date: string; cost: number; turns: number }> = [];
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset - 51 * 7);

  const costMap = new Map<string, { cost: number; turns: number }>();
  for (const d of dailyCosts) {
    costMap.set(d.period, { cost: d.totalCostUsd, turns: d.turnCount });
  }

  for (let i = 0; i < 364; i++) {
    const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const key = date.toISOString().slice(0, 10);
    const data = costMap.get(key) || { cost: 0, turns: 0 };
    days.push({ date: key, cost: data.cost, turns: data.turns });
  }

  return JSON.stringify(days);
}

export function getUnknownModelBannerHtml(diagnostics: UnknownModelDiagnostics): string {
  if (diagnostics.excludedTurnCount > 0) {
    const modelList = diagnostics.excludedModels.slice(0, 5).join(", ");
    const moreCount = Math.max(0, diagnostics.excludedModels.length - 5);
    const moreText = moreCount > 0 ? ` (+${moreCount} more)` : "";
    return `
      <div style="margin:10px 16px 0 16px;padding:10px 12px;border:1px solid var(--vscode-editorWarning-foreground, #cca700);border-left:3px solid var(--vscode-editorWarning-foreground, #cca700);border-radius:4px;background:var(--vscode-editorWidget-background);font-size:12px;line-height:1.45">
        <strong>Unknown models excluded from totals</strong>: ${diagnostics.excludedTurnCount} turns across ${diagnostics.excludedModelCount} model(s) were excluded because <code>copilotCostTracker.excludeUnknownModelsFromTotals</code> is enabled.${modelList ? ` Missing models: ${modelList}${moreText}.` : ""}
      </div>`;
  }

  if (diagnostics.fallbackModelCount > 0) {
    const modelList = diagnostics.fallbackModels.slice(0, 5).join(", ");
    const moreCount = Math.max(0, diagnostics.fallbackModels.length - 5);
    const moreText = moreCount > 0 ? ` (+${moreCount} more)` : "";
    return `
      <div style="margin:10px 16px 0 16px;padding:10px 12px;border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:4px;background:var(--vscode-editorWidget-background);font-size:12px;line-height:1.45;color:var(--muted)">
        Unknown model pricing fallback is active for ${diagnostics.fallbackModelCount} model(s). Add <code>copilotCostTracker.customModelRates</code> for more accurate totals.${modelList ? ` Models: ${modelList}${moreText}.` : ""}
      </div>`;
  }

  return "";
}
