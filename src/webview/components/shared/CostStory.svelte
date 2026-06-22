<script lang="ts">
  import { dashboardData, formatUsd } from '../../stores/dashboard';
  import { filteredSessions } from '../../stores/filteredSessions';

  $: data = $dashboardData;
  $: sessions = $filteredSessions;
  $: fmt = $formatUsd;

  // Light model-name tidy-up for prose (e.g. "claude-sonnet-4.5" → "Claude Sonnet 4.5").
  function simplifyModel(raw: string): string {
    if (!raw) return 'A model';
    return raw
      .split(/[-_]/)
      .map(p => (/^\d/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
      .join(' ');
  }

  // Each story line is a small set of segments so we can emphasize key figures.
  type Segment = { text: string; strong?: boolean; color?: string };

  $: lines = (() => {
    const out: Segment[][] = [];
    if (sessions.length === 0) return out;

    const rangeCost = sessions.reduce((s, x) => s + x.totalCostUsd, 0);
    const rangeTurns = sessions.reduce((s, x) => s + x.turnCount, 0);

    // 1. Headline spend
    out.push([
      { text: 'You spent ' },
      { text: fmt(rangeCost), strong: true, color: 'var(--cct-accent)' },
      { text: ` across ${sessions.length} session${sessions.length === 1 ? '' : 's'} and ${rangeTurns.toLocaleString()} turns.` },
    ]);

    // 2. Top model
    const modelMap = new Map<string, number>();
    for (const s of sessions) modelMap.set(s.primaryModel, (modelMap.get(s.primaryModel) ?? 0) + s.totalCostUsd);
    const topModel = [...modelMap.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topModel && rangeCost > 0) {
      const pct = (topModel[1] / rangeCost) * 100;
      out.push([
        { text: `${simplifyModel(topModel[0])} drove ` },
        { text: `${pct.toFixed(0)}%`, strong: true, color: 'var(--cct-purple)' },
        { text: ' of that spend.' },
      ]);
    }

    // 3. Most expensive session
    const priciest = [...sessions].sort((a, b) => b.totalCostUsd - a.totalCostUsd)[0];
    if (priciest && priciest.totalCostUsd > 0) {
      const name = priciest.title?.trim() || priciest.workspace || 'a session';
      out.push([
        { text: 'Your priciest session was ' },
        { text: `"${name}"`, strong: true },
        { text: ' at ' },
        { text: fmt(priciest.totalCostUsd), strong: true, color: 'var(--cct-warning)' },
        { text: '.' },
      ]);
    }

    // 4. Cache insight
    const totalInput = sessions.reduce((s, x) => s + x.totalInputTokens, 0);
    const totalCached = sessions.reduce((s, x) => s + x.totalCachedTokens, 0);
    const billable = totalInput + totalCached;
    if (billable > 5000) {
      const hit = (totalCached / billable) * 100;
      if (hit >= 70) {
        out.push([
          { text: 'Caching is working well — ' },
          { text: `${hit.toFixed(0)}%`, strong: true, color: 'var(--cct-success)' },
          { text: ' of your input was reused from cache.' },
        ]);
      } else if (hit < 40) {
        out.push([
          { text: 'Only ' },
          { text: `${hit.toFixed(0)}%`, strong: true, color: 'var(--cct-danger)' },
          { text: ' of input hit cache — keeping related work in one chat would cut cost.' },
        ]);
      }
    }

    return out.slice(0, 4);
  })();
</script>

{#if lines.length > 0}
  <div class="story">
    <div class="story-title">Cost Story</div>
    <ul class="story-lines">
      {#each lines as line}
        <li>
          {#each line as seg}
            <span class:strong={seg.strong} style={seg.color ? `color:${seg.color}` : ''}>{seg.text}</span>
          {/each}
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .story {
    background: color-mix(in srgb, var(--vscode-editorWidget-background) 80%, var(--cct-purple, #ba68c8) 8%);
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, var(--cct-purple, #ba68c8) 30%);
    border-radius: 10px;
    padding: 14px 16px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  }

  .story-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 8px;
  }

  .story-lines {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .story-lines li {
    font-size: 13px;
    line-height: 1.5;
    color: var(--vscode-editor-foreground);
    position: relative;
    padding-left: 16px;
  }

  .story-lines li::before {
    content: '•';
    position: absolute;
    left: 2px;
    color: var(--cct-accent, #4fc3f7);
  }

  .story-lines .strong {
    font-weight: 700;
  }
</style>
