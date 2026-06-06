import type { DashboardViewData } from "./index";

export function renderEstimatesTab(v: DashboardViewData): string {
  return `
  <div class="tab-content" id="tab-estimates">
    <div style="background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-editorWarning-foreground, #cca700);border-radius:4px;padding:10px 14px;margin-bottom:16px;font-size:12px;line-height:1.5">
      <strong>⚠ Speculative Estimates</strong> — These numbers are approximations based on token counts and industry-average typing speed (175 chars/min coding baseline, ~30% over raw typing to account for thinking time). Copilot does not expose acceptance rate, keystroke counts, or retained-LOC data to third-party extensions. Use these to spot trends, not for billing or performance reviews.
    </div>
    <div class="stat-row">
      <div class="stat">
        <div class="stat-label">Est. Time Saved (30d)</div>
        <div class="stat-value">${v.estHoursSaved}h</div>
        <div class="stat-sub">output chars / 175 CPM, capped at 2 min/turn</div>
      </div>
      <div class="stat">
        <div class="stat-label">Cost per Output-K Tokens</div>
        <div class="stat-value">$${v.costPerOutputK}</div>
        <div class="stat-sub">USD per 1,000 output tokens (30d)</div>
      </div>
      <div class="stat">
        <div class="stat-label">Output Tokens (30d)</div>
        <div class="stat-value">${v.outputTokensK}K</div>
        <div class="stat-sub">generated text across all models</div>
      </div>
      <div class="stat">
        <div class="stat-label">Input Overhead</div>
        <div class="stat-value">${v.inputOverheadPct}%</div>
        <div class="stat-sub">of all tokens are context, not generation</div>
      </div>
    </div>
    <h3 style="margin:20px 0 8px;font-size:12px;font-weight:600;text-transform:uppercase;color:var(--muted)">Formula Reference</h3>
    <table>
      <thead><tr><th>Metric</th><th>Formula</th><th>Assumption</th><th>Known Limitation</th></tr></thead>
      <tbody>
        <tr><td>Time Saved</td><td><code>min(output_chars / 175 CPM, turns x 2 min)</code></td><td>1 token ~ 4 chars; developer codes at 175 chars/min</td><td>No acceptance rate — assumes 100% of output is used</td></tr>
        <tr><td>Cost per Output-K</td><td><code>monthly_cost / (output_tokens / 1000)</code></td><td>Linear cost-per-token relationship</td><td>Cached tokens reduce cost but are excluded from denominator</td></tr>
        <tr><td>Input Overhead</td><td><code>(input + cached) / (input + cached + output)</code></td><td>All token categories reported by the API</td><td>High values (&gt;90%) are normal for agent workflows with large context</td></tr>
      </tbody>
    </table>
    <div style="margin-top:16px;padding:10px 14px;background:var(--vscode-editorWidget-background);border-radius:4px;font-size:11px;color:var(--muted)">
      <strong>What is not tracked:</strong> Acceptance rate (ghost text Tab/Esc), retained lines of code after editing, copy/insert events from chat panel, and per-request HTTP error codes. These require hooks into Copilot internals that are not exposed to third-party extensions.
    </div>
  </div>`;
}
