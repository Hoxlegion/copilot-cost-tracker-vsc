<script lang="ts">
  import { dashboardData, formatUsd } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import { PALETTE, withAlpha } from '../../utils/palette';
  import { formatTokens } from '../../utils/format';

  $: data = $dashboardData;

  // ── Sessions in range (by context distribution) ──
  $: distribution = (() => {
    const all = data?.contextDistribution ?? [];
    return all.filter(d => {
      if ($filterState.fromMs !== null && d.startMs < $filterState.fromMs) return false;
      if ($filterState.toMs !== null && d.startMs > $filterState.toMs) return false;
      return true;
    });
  })();

  $: inRangeIds = new Set(distribution.map(d => d.sessionId));
  $: timelines = (data?.contextTimelines ?? []).filter(t => inRangeIds.has(t.sessionId));

  // ── Average context growth curve across sessions (per turn index) ──
  $: maxTurns = Math.max(1, ...timelines.map(t => t.turns.length));
  $: avgCurve = (() => {
    const sums = new Array(maxTurns).fill(0);
    const counts = new Array(maxTurns).fill(0);
    for (const t of timelines) {
      t.turns.forEach((turn, i) => {
        sums[i] += turn.currentContextWeight;
        counts[i] += 1;
      });
    }
    return sums.map((s, i) => (counts[i] > 0 ? s / counts[i] : 0));
  })();

  // ── Headline metrics ──
  $: peakContext = distribution.reduce((m, d) => Math.max(m, d.currentContextWeight), 0);
  $: avgContext = distribution.length > 0
    ? distribution.reduce((s, d) => s + d.currentContextWeight, 0) / distribution.length
    : 0;

  // The "context tax": cost attributable to re-sent conversation history. Cached
  // tokens are the re-sent history; we price them with the measured per-cached-token
  // cost so the figure reflects real billing rather than a guess.
  $: contextTax = (() => {
    const cs = data?.cacheSavings;
    if (!cs || cs.totalCacheReadTokens <= 0) return null;
    // Approximate cost of the cached (re-sent) tokens: savings is (full − cached);
    // cached cost ≈ cached tokens × (input − savings-per-token). We only have
    // savings, so present the re-sent volume and what caching saved instead.
    return {
      reSentTokens: cs.totalCacheReadTokens,
      saved: cs.totalSavingsCostUsd,
    };
  })();

  $: hasData = timelines.length > 0 && maxTurns > 1;

  // ── SVG path for the average growth curve ──
  const W = 100;
  const H = 32;
  $: curveMax = Math.max(1, ...avgCurve);
  $: points = avgCurve.map((v, i) => {
    const x = avgCurve.length > 1 ? (i / (avgCurve.length - 1)) * W : 0;
    const y = H - (v / curveMax) * H;
    return { x, y };
  });
  $: linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  $: areaPath = points.length > 0
    ? `${linePath} L${W},${H} L0,${H} Z`
    : '';

  const accent = PALETTE.accent;
  const fill = withAlpha(PALETTE.accent, 0.18);
</script>

<div class="ctx-hero">
  <div class="ctx-head">
    <div>
      <div class="ctx-title">The Context Tax</div>
      <div class="ctx-subtitle">Every turn resends your conversation history — here's its weight</div>
    </div>
  </div>

  {#if hasData}
    <div class="ctx-grid">
      <div class="ctx-chart">
        <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" class="curve">
          <path d={areaPath} fill={fill} />
          <path d={linePath} fill="none" stroke={accent} stroke-width="1.5" vector-effect="non-scaling-stroke" />
        </svg>
        <div class="ctx-chart-caption">Avg context growth across {timelines.length} session{timelines.length === 1 ? '' : 's'} · turn 1 → {maxTurns}</div>
      </div>

      <div class="ctx-metrics">
        <div class="ctx-metric">
          <div class="ctx-metric-value">{formatTokens(Math.round(avgContext))}</div>
          <div class="ctx-metric-label">avg history / session</div>
        </div>
        <div class="ctx-metric">
          <div class="ctx-metric-value danger">{formatTokens(Math.round(peakContext))}</div>
          <div class="ctx-metric-label">heaviest session</div>
        </div>
        {#if contextTax}
          <div class="ctx-metric">
            <div class="ctx-metric-value success">{$formatUsd(contextTax.saved)}</div>
            <div class="ctx-metric-label">saved by caching</div>
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="ctx-empty">
      <span class="ctx-empty-icon">🧠</span>
      Not enough multi-turn sessions yet. Keep chatting and your context curve will appear here.
    </div>
  {/if}
</div>

<style>
  .ctx-hero {
    background: color-mix(in srgb, var(--vscode-editorWidget-background) 74%, var(--cct-accent, #4fc3f7) 9%);
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 60%, var(--cct-accent, #4fc3f7) 40%);
    border-radius: 12px;
    padding: 16px 18px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  }

  .ctx-head {
    margin-bottom: 12px;
  }

  .ctx-title {
    font-size: 14px;
    font-weight: 800;
    color: var(--vscode-editor-foreground);
  }

  .ctx-subtitle {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-top: 2px;
  }

  .ctx-grid {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 16px;
    align-items: center;
  }

  .ctx-chart {
    min-width: 0;
  }

  .curve {
    width: 100%;
    height: 56px;
    display: block;
  }

  .ctx-chart-caption {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    margin-top: 4px;
  }

  .ctx-metrics {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ctx-metric {
    display: flex;
    flex-direction: column;
  }

  .ctx-metric-value {
    font-size: 18px;
    font-weight: 800;
    color: var(--vscode-editor-foreground);
    line-height: 1.1;
  }

  .ctx-metric-value.danger { color: var(--cct-danger, #e57373); }
  .ctx-metric-value.success { color: var(--cct-success, #81c784); }

  .ctx-metric-label {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .ctx-empty {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    padding: 8px 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .ctx-empty-icon {
    font-size: 18px;
  }
</style>
