<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import ChartWrapper from '../shared/ChartWrapper.svelte';
  import { tooltipConfig, baseScaleConfig, LEGEND_COLOR } from '../../utils/chartStyles';
  import { PALETTE } from '../../utils/palette';
  
  $: dailyCosts = $dashboardData?.dailyCosts ?? [];
  
  $: filteredDailyCosts = dailyCosts.filter(d => {
    const dayTs = new Date(d.period + 'T00:00:00').getTime();
    const dayEndTs = dayTs + 86400000 - 1;
    if ($filterState.fromMs !== null && dayEndTs < $filterState.fromMs) return false;
    if ($filterState.toMs !== null && dayTs > $filterState.toMs) return false;
    return true;
  });
  
  $: sortedData = [...filteredDailyCosts].sort((a, b) => 
    a.period.localeCompare(b.period)
  );
  
  $: labels = sortedData.map(d => d.period);
  $: costData = sortedData.map(d => d.totalCostUsd);
  $: turnsData = sortedData.map(d => d.turnCount);
  
  // Cost (USD) and Turns are genuinely different metrics, so they share one
  // chart on dual axes. (Credits = cost × 100, so a separate credits line would
  // just duplicate the cost line.)
  $: chartData = {
    labels,
    datasets: [
      {
        label: 'Cost (USD)',
        data: costData,
        borderColor: PALETTE.accent,
        backgroundColor: 'rgba(79, 195, 247, 0.1)',
        fill: true,
        yAxisID: 'y',
        tension: 0.4,
        pointRadius: 2,
        pointHoverRadius: 5,
      },
      {
        label: 'Turns',
        data: turnsData,
        borderColor: PALETTE.warning,
        backgroundColor: 'rgba(255, 183, 77, 0.1)',
        fill: true,
        yAxisID: 'y1',
        tension: 0.4,
        pointRadius: 2,
        pointHoverRadius: 5,
      },
    ]
  };
  
  $: gradientColors = [
    { color: PALETTE.accent, startAlpha: 0.3, endAlpha: 0 },
    { color: PALETTE.warning, startAlpha: 0.2, endAlpha: 0 },
  ];
  
  $: chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    scales: {
      y: {
        type: 'linear' as const,
        display: true,
        position: 'left' as const,
        title: {
          display: true,
          text: 'Cost (USD)',
          color: baseScaleConfig.ticks.color,
          font: { size: baseScaleConfig.ticks.font.size },
        },
        grid: baseScaleConfig.grid,
        ticks: baseScaleConfig.ticks,
      },
      y1: {
        type: 'linear' as const,
        display: true,
        position: 'right' as const,
        beginAtZero: true,
        title: {
          display: true,
          text: 'Turns',
          color: baseScaleConfig.ticks.color,
          font: { size: baseScaleConfig.ticks.font.size },
        },
        grid: {
          drawOnChartArea: false,
        },
        ticks: baseScaleConfig.ticks,
      },
    },
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: {
          color: LEGEND_COLOR,
          font: { size: 11 },
          usePointStyle: true,
          pointStyle: 'circle',
        },
      },
      tooltip: tooltipConfig,
    },
  };
</script>

<div class="daily-chart">
  <div class="chart-header">
    <h3>Daily Activity</h3>
  </div>
  <div class="chart-container">
    <ChartWrapper 
      type="line"
      data={chartData}
      options={chartOptions}
      canvasId="dailyChart"
      gradientColors={gradientColors}
    />
  </div>
</div>

<style>
  .daily-chart {
    background: color-mix(in srgb, var(--vscode-editorWidget-background) 78%, #103449 22%);
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, #2aa5ff 30%);
    border-radius: 10px;
    padding: 16px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.16);
  }
  
  .chart-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }
  
  .chart-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }
  
  .chart-container {
    height: 300px;
    position: relative;
  }
</style>
