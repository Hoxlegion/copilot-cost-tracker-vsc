<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import ChartWrapper from '../shared/ChartWrapper.svelte';
  import { tooltipConfig, baseScaleConfig } from '../../utils/chartStyles';
  
  $: allDistribution = $dashboardData?.contextDistribution ?? [];
  
  $: contextDistribution = allDistribution.filter(d => {
    if ($filterState.fromMs !== null && d.startMs < $filterState.fromMs) return false;
    if ($filterState.toMs !== null && d.startMs > $filterState.toMs) return false;
    return true;
  });
  
  $: chartData = {
    datasets: [
      {
        label: 'Light (0-5K)',
        data: contextDistribution
          .filter(d => d.currentContextWeight <= 5000)
          .map(d => ({ x: d.turnCount, y: d.currentContextWeight })),
        backgroundColor: 'rgba(129, 199, 132, 0.7)',
        borderColor: 'rgba(129, 199, 132, 1)',
        pointRadius: 5,
        pointHoverRadius: 7,
      },
      {
        label: 'Moderate (5K-20K)',
        data: contextDistribution
          .filter(d => d.currentContextWeight > 5000 && d.currentContextWeight <= 20000)
          .map(d => ({ x: d.turnCount, y: d.currentContextWeight })),
        backgroundColor: 'rgba(255, 183, 77, 0.7)',
        borderColor: 'rgba(255, 183, 77, 1)',
        pointRadius: 5,
        pointHoverRadius: 7,
      },
      {
        label: 'Heavy (20K-40K)',
        data: contextDistribution
          .filter(d => d.currentContextWeight > 20000 && d.currentContextWeight <= 40000)
          .map(d => ({ x: d.turnCount, y: d.currentContextWeight })),
        backgroundColor: 'rgba(255, 138, 101, 0.7)',
        borderColor: 'rgba(255, 138, 101, 1)',
        pointRadius: 5,
        pointHoverRadius: 7,
      },
      {
        label: 'Critical (40K+)',
        data: contextDistribution
          .filter(d => d.currentContextWeight > 40000)
          .map(d => ({ x: d.turnCount, y: d.currentContextWeight })),
        backgroundColor: 'rgba(229, 115, 115, 0.7)',
        borderColor: 'rgba(229, 115, 115, 1)',
        pointRadius: 5,
        pointHoverRadius: 7,
      },
    ],
  };
  
  $: chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'linear' as const,
        title: {
          display: true,
          text: 'Turns in Session',
          color: baseScaleConfig.ticks.color,
          font: { size: baseScaleConfig.ticks.font.size },
        },
        grid: baseScaleConfig.grid,
        ticks: baseScaleConfig.ticks,
      },
      y: {
        type: 'linear' as const,
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
        display: true,
        position: 'top' as const,
        labels: {
          color: 'rgba(255, 255, 255, 0.7)',
          font: { size: 11 },
          usePointStyle: true,
          pointStyle: 'circle',
        },
      },
      tooltip: {
        ...tooltipConfig,
        callbacks: {
          label: function(context: any) {
            const tokens = context.parsed.y;
            const turns = context.parsed.x;
            const pages = Math.round(tokens / 2500);
            return `${turns} turns · ${tokens.toLocaleString()} tokens (~${pages} pages)`;
          },
        },
      },
      annotation: {
        annotations: {
          line5k: {
            type: 'line',
            yMin: 5000,
            yMax: 5000,
            borderColor: 'rgba(129, 199, 132, 0.3)',
            borderWidth: 1,
            borderDash: [5, 5],
          },
          line20k: {
            type: 'line',
            yMin: 20000,
            yMax: 20000,
            borderColor: 'rgba(255, 183, 77, 0.3)',
            borderWidth: 1,
            borderDash: [5, 5],
          },
          line40k: {
            type: 'line',
            yMin: 40000,
            yMax: 40000,
            borderColor: 'rgba(229, 115, 115, 0.3)',
            borderWidth: 1,
            borderDash: [5, 5],
          },
        },
      },
    },
  };
</script>

<div class="context-scatter-chart">
  <ChartWrapper 
    type="scatter"
    data={chartData}
    options={chartOptions}
    canvasId="contextScatterChart"
  />
</div>

<style>
  .context-scatter-chart {
    height: 300px;
    position: relative;
  }
</style>
