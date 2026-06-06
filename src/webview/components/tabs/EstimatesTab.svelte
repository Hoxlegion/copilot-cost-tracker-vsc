<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  
  $: data = $dashboardData;
  $: insightMetrics = data?.insightMetrics;
  $: monthCostUsd = data?.monthTotal.costUsd ?? 0;
  
  $: estHoursSaved = (() => {
    if (!insightMetrics) return '0.0';
    const charsPerToken = 4;
    const charsPerMinute = 175;
    const maxMinsPerTurn = 2;
    const outputChars30d = insightMetrics.totalOutputTokens * charsPerToken;
    const rawMinutesSaved = outputChars30d / charsPerMinute;
    const cappedMinutesSaved = Math.min(rawMinutesSaved, insightMetrics.totalTurns * maxMinsPerTurn);
    return (cappedMinutesSaved / 60).toFixed(1);
  })();
  
  $: costPerOutputK = (() => {
    if (!insightMetrics || insightMetrics.totalOutputTokens < 1000) return '—';
    return (monthCostUsd / (insightMetrics.totalOutputTokens / 1000)).toFixed(3);
  })();
  
  $: outputTokensK = insightMetrics 
    ? (insightMetrics.totalOutputTokens / 1000).toFixed(1) 
    : '0.0';
  
  $: inputOverheadPct = (() => {
    if (!insightMetrics) return '0';
    const totalIn = insightMetrics.totalInputTokens + insightMetrics.totalCachedTokens;
    const totalAll = totalIn + insightMetrics.totalOutputTokens;
    return totalAll > 0 ? Math.round((totalIn / totalAll) * 100).toString() : '0';
  })();
</script>

<div class="estimates-tab">
  <div class="warning-banner">
    <strong>⚠ Speculative Estimates</strong> — These numbers are approximations based on token counts and industry-average typing speed (175 chars/min coding baseline, ~30% over raw typing to account for thinking time). Copilot does not expose acceptance rate, keystroke counts, or retained-LOC data to third-party extensions. Use these to spot trends, not for billing or performance reviews.
  </div>
  
  <div class="stat-row">
    <div class="stat">
      <div class="stat-label">Est. Time Saved (30d)</div>
      <div class="stat-value">{estHoursSaved}h</div>
      <div class="stat-sub">output chars ÷ 175 CPM, capped at 2 min/turn</div>
    </div>
    <div class="stat">
      <div class="stat-label">Cost per Output-K Tokens</div>
      <div class="stat-value">${costPerOutputK}</div>
      <div class="stat-sub">USD per 1,000 output tokens (30d)</div>
    </div>
    <div class="stat">
      <div class="stat-label">Output Tokens (30d)</div>
      <div class="stat-value">{outputTokensK}K</div>
      <div class="stat-sub">generated text across all models</div>
    </div>
    <div class="stat">
      <div class="stat-label">Input Overhead</div>
      <div class="stat-value">{inputOverheadPct}%</div>
      <div class="stat-sub">of all tokens are context, not generation</div>
    </div>
  </div>
  
  <h3 class="section-title">Formula Reference</h3>
  <table>
    <thead>
      <tr>
        <th>Metric</th>
        <th>Formula</th>
        <th>Assumption</th>
        <th>Known Limitation</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Time Saved</td>
        <td><code>min(output_chars ÷ 175 CPM, turns × 2 min)</code></td>
        <td>1 token ≈ 4 chars; developer codes at 175 chars/min</td>
        <td>No acceptance rate — assumes 100% of output is used</td>
      </tr>
      <tr>
        <td>Cost per Output-K</td>
        <td><code>monthly_cost ÷ (output_tokens ÷ 1000)</code></td>
        <td>Linear cost-per-token relationship</td>
        <td>Cached tokens reduce cost but are excluded from denominator</td>
      </tr>
      <tr>
        <td>Input Overhead</td>
        <td><code>(input + cached) ÷ (input + cached + output)</code></td>
        <td>All token categories reported by the API</td>
        <td>High values (&gt;90%) are normal for agent workflows with large context</td>
      </tr>
    </tbody>
  </table>
  
  <div class="info-banner">
    <strong>What is not tracked:</strong> Acceptance rate (ghost text Tab/Esc), retained lines of code after editing, copy/insert events from chat panel, and per-request HTTP error codes. These require hooks into Copilot internals that are not exposed to third-party extensions.
  </div>
</div>

<style>
  .estimates-tab {
    padding: 0;
  }
  
  .warning-banner {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-editorWarning-foreground, #cca700);
    border-radius: 4px;
    padding: 10px 14px;
    margin-bottom: 16px;
    font-size: 12px;
    line-height: 1.5;
  }
  
  .info-banner {
    margin-top: 16px;
    padding: 10px 14px;
    background: var(--vscode-editorWidget-background);
    border-radius: 4px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  
  .stat-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }
  
  .stat {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 10px 12px;
  }
  
  .stat-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .stat-value {
    font-size: 20px;
    font-weight: 700;
    margin-top: 2px;
  }
  
  .stat-sub {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-top: 1px;
  }
  
  .section-title {
    margin: 20px 0 8px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
  
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  
  th, td {
    padding: 8px;
    text-align: left;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  
  th {
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
  }
  
  code {
    background: var(--vscode-textBlockQuote-background);
    padding: 2px 4px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family);
    font-size: 11px;
  }
</style>
