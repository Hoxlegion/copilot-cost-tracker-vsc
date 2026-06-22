<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filteredSessions } from '../../stores/filteredSessions';
  import { filterState } from '../../stores/filter';
  import { scoreColor } from '../../utils/palette';
  import { computeEfficiency } from '../../utils/efficiency';

  $: data = $dashboardData;
  $: sessions = $filteredSessions;

  // ── Context distribution within the active range ──
  $: contextDistribution = (() => {
    const all = data?.contextDistribution ?? [];
    return all.filter(d => {
      if ($filterState.fromMs !== null && d.startMs < $filterState.fromMs) return false;
      if ($filterState.toMs !== null && d.startMs > $filterState.toMs) return false;
      return true;
    });
  })();

  // ── Component metrics ──
  $: totalInput = sessions.reduce((s, x) => s + x.totalInputTokens, 0);
  $: totalCached = sessions.reduce((s, x) => s + x.totalCachedTokens, 0);
  $: totalOutput = sessions.reduce((s, x) => s + x.totalOutputTokens, 0);
  $: billableInput = totalInput + totalCached;
  $: cacheHitPct = billableInput > 0 ? (totalCached / billableInput) * 100 : 0;
  $: avgContext = contextDistribution.length > 0
    ? contextDistribution.reduce((s, d) => s + d.currentContextWeight, 0) / contextDistribution.length
    : 0;

  // ── Composite score (shared with the Optimization Score bar) ──
  $: eff = computeEfficiency({
    cacheHitPct,
    avgContextTokens: avgContext,
    netInputTokens: totalInput,
    outputTokens: totalOutput,
  });
  $: score = eff.score;
  $: ioRatio = eff.ioRatio;
  $: grade = eff.grade;
  $: color = scoreColor(score);

  $: caption = (() => {
    if (sessions.length === 0) return 'No activity in range yet.';
    if (score >= 80) return 'Lean usage — you are getting strong value per credit.';
    if (score >= 55) return 'Solid, with room to tighten context and caching.';
    return 'Lots of waste here — see the tips below.';
  })();

  // SVG gauge geometry
  const R = 34;
  const C = 2 * Math.PI * R;
  $: dash = (Math.max(0, Math.min(100, score)) / 100) * C;

  $: components = [
    { label: 'Cache reuse', value: `${cacheHitPct.toFixed(0)}%`, pct: (eff.cacheScore / eff.weights.cache) * 100 },
    { label: 'Context size', value: avgContext > 0 ? `${(avgContext / 1000).toFixed(1)}K` : '—', pct: (eff.contextScore / eff.weights.context) * 100 },
    { label: 'Input:Output', value: ioRatio > 0 ? `${ioRatio.toFixed(1)}:1` : '—', pct: (eff.ioScore / eff.weights.io) * 100 },
  ];
</script>

<div class="grade-card" style="--grade-color:{color}">
  <div class="gauge">
    <svg viewBox="0 0 80 80" width="80" height="80">
      <circle cx="40" cy="40" r={R} class="gauge-track" />
      <circle
        cx="40" cy="40" r={R}
        class="gauge-fill"
        stroke-dasharray="{dash} {C}"
        transform="rotate(-90 40 40)"
      />
    </svg>
    <div class="gauge-center">
      <div class="grade-letter">{grade}</div>
      <div class="grade-score">{score}<span>/100</span></div>
    </div>
  </div>

  <div class="grade-body">
    <div class="grade-title">Efficiency Grade</div>
    <div class="grade-caption">{caption}</div>
    <div class="components">
      {#each components as c}
        <div class="component">
          <div class="component-head">
            <span class="component-label">{c.label}</span>
            <span class="component-value">{c.value}</span>
          </div>
          <div class="component-track">
            <div class="component-bar" style="width:{Math.max(0, Math.min(100, c.pct))}%"></div>
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .grade-card {
    display: flex;
    gap: 18px;
    align-items: center;
    background: color-mix(in srgb, var(--vscode-editorWidget-background) 72%, var(--grade-color) 10%);
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, var(--grade-color) 40%);
    border-radius: 12px;
    padding: 16px 18px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  }

  .gauge {
    position: relative;
    width: 80px;
    height: 80px;
    flex-shrink: 0;
  }

  .gauge-track {
    fill: none;
    stroke: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
    stroke-width: 7;
  }

  .gauge-fill {
    fill: none;
    stroke: var(--grade-color);
    stroke-width: 7;
    stroke-linecap: round;
    transition: stroke-dasharray 0.5s ease;
  }

  .gauge-center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  .grade-letter {
    font-size: 26px;
    font-weight: 800;
    color: var(--grade-color);
  }

  .grade-score {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    margin-top: 2px;
  }

  .grade-score span {
    opacity: 0.6;
  }

  .grade-body {
    flex: 1;
    min-width: 0;
  }

  .grade-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--vscode-editor-foreground);
  }

  .grade-caption {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin: 2px 0 10px;
  }

  .components {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .component-head {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    margin-bottom: 3px;
  }

  .component-label {
    color: var(--vscode-descriptionForeground);
  }

  .component-value {
    font-weight: 600;
    color: var(--vscode-editor-foreground);
  }

  .component-track {
    height: 4px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
    overflow: hidden;
  }

  .component-bar {
    height: 100%;
    border-radius: 2px;
    background: var(--grade-color);
    transition: width 0.4s ease;
  }
</style>
