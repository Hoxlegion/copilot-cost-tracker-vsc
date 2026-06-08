<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import ChartWrapper from '../shared/ChartWrapper.svelte';
  import { tooltipConfig, baseScaleConfig } from '../../utils/chartStyles';
  
  const LINE_COLORS = [
    'rgba(229, 115, 115, 0.9)',
    'rgba(255, 183, 77, 0.9)',
    'rgba(129, 199, 132, 0.9)',
    'rgba(79, 195, 247, 0.9)',
    'rgba(186, 104, 200, 0.9)',
  ];
  
  $: contextTimelines = $dashboardData?.contextTimelines ?? [];
  
  $: chartData = {
    labels: [],
    datasets: contextTimelines.slice(0, 5).map((timeline, i) => ({
      label: `Session ${timeline.sessionId.slice(0, 8)}...`,
      data: timeline.turns.map(t => t.currentContextWeight),
      borderColor: LINE_COLORS[i % LINE_COLORS.length],
      backgroundColor: LINE_COLORS[i % LINE_COLORS.length].replace('0.9', '0.1'),
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      fill: false,
      tension: 0.3,
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
