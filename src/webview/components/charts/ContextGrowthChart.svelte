<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import ChartWrapper from '../shared/ChartWrapper.svelte';
  import { tooltipConfig, baseScaleConfig } from '../../utils/chartStyles';
  
  const LINE_COLORS = [
    'rgba(229, 115, 115, 0.9)',
    'rgba(255, 183, 77, 0.9)',
    'rgba(129, 199, 132, 0.9)',
    'rgba(79, 195, 247, 0.9)',
    'rgba(186, 104, 200, 0.9)',
  ];
  
  const FILL_COLORS = [
    'rgba(229, 115, 115, 0.15)',
    'rgba(255, 183, 77, 0.15)',
    'rgba(129, 199, 132, 0.15)',
    'rgba(79, 195, 247, 0.15)',
    'rgba(186, 104, 200, 0.15)',
  ];
  
  function formatSessionLabel(workspace: string, startMs: number, sessionId: string): string {
    const shortId = sessionId.slice(0, 5);
    const d = new Date(startMs);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const month = months[d.getMonth()];
    const day = d.getDate();
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const dateStr = `${month} ${day}, ${hours}:${minutes} ${ampm}`;
    const ws = workspace.length > 20 ? workspace.slice(0, 17) + '...' : workspace;
    return `${ws} · ${dateStr} (${shortId})`;
  }
  
  $: allTimelines = $dashboardData?.contextTimelines ?? [];
  $: contextDistribution = $dashboardData?.contextDistribution ?? [];
  
  $: filteredSessionIds = new Set(
    contextDistribution
      .filter(d => {
        if ($filterState.fromMs !== null && d.startMs < $filterState.fromMs) return false;
        if ($filterState.toMs !== null && d.startMs > $filterState.toMs) return false;
        return true;
      })
      .map(d => d.sessionId)
  );
  
  $: contextTimelines = allTimelines.filter(t => filteredSessionIds.has(t.sessionId));
  
  $: chartData = {
    labels: [],
    datasets: contextTimelines.slice(0, 5).map((timeline, i) => ({
      label: formatSessionLabel(timeline.workspace, timeline.startMs, timeline.sessionId),
      data: timeline.turns.map(t => t.currentContextWeight),
      borderColor: LINE_COLORS[i % LINE_COLORS.length],
      backgroundColor: FILL_COLORS[i % FILL_COLORS.length],
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 3,
      fill: true,
      tension: 0.3,
      spanGaps: true,
    })),
  };
  
  $: maxTurns = Math.max(
    ...contextTimelines.map(t => t.turns.length),
    1
  );
  
  $: chartDataWithLabels = {
    ...chartData,
    labels: Array.from({ length: maxTurns }, (_, i) => `${i + 1}`),
  };
  
  $: chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    scales: {
      x: {
        title: {
          display: true,
          text: 'Turn Number',
          color: baseScaleConfig.ticks.color,
          font: { size: baseScaleConfig.ticks.font.size },
        },
        grid: baseScaleConfig.grid,
        ticks: baseScaleConfig.ticks,
      },
      y: {
        title: {
          display: true,
          text: 'Context Weight (tokens)',
          color: baseScaleConfig.ticks.color,
          font: { size: baseScaleConfig.ticks.font.size },
        },
        grid: baseScaleConfig.grid,
        ticks: {
          ...baseScaleConfig.ticks,
          callback: function(value: number) {
            if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
            return value;
          },
        },
      },
    },
    plugins: {
      legend: {
        display: contextTimelines.length > 1,
        position: 'top' as const,
        labels: {
          color: 'rgba(255, 255, 255, 0.7)',
          font: { size: 11 },
          usePointStyle: true,
          pointStyle: 'line',
          boxWidth: 20,
          padding: 12,
        },
      },
      tooltip: {
        ...tooltipConfig,
        callbacks: {
          label: function(context: any) {
            const tokens = context.parsed.y;
            const pages = Math.round(tokens / 2500);
            return `${context.dataset.label}: ${tokens.toLocaleString()} tokens (~${pages} pages)`;
          },
        },
      },
    },
  };
</script>

{#if contextTimelines.length > 0}
  <div class="context-growth-chart">
    <ChartWrapper 
      type="line"
      data={chartDataWithLabels}
      options={chartOptions}
      canvasId="contextGrowthChart"
    />
  </div>
{:else}
  <div class="no-data">No session data available for context growth visualization.</div>
{/if}

<style>
  .context-growth-chart {
    height: 300px;
    position: relative;
  }
  
  .no-data {
    height: 300px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }
</style>
