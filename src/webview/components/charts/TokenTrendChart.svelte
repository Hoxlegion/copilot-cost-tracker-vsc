<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import ChartWrapper from '../shared/ChartWrapper.svelte';
  import { tooltipConfig, baseScaleConfig } from '../../utils/chartStyles';
  
  $: insightMetricsFullRange = $dashboardData?.insightMetricsFullRange;
  $: ioRatioDays = insightMetricsFullRange?.ioRatioDays ?? [];
  
  $: filteredDays = ioRatioDays.filter(d => {
    const dayTs = new Date(d.period + 'T00:00:00').getTime();
    const dayEndTs = dayTs + 86400000 - 1;
    if ($filterState.fromMs !== null && dayEndTs < $filterState.fromMs) return false;
    if ($filterState.toMs !== null && dayTs > $filterState.toMs) return false;
    return true;
  });
  
  $: labels = filteredDays.map(d => d.period);
  $: cachedData = filteredDays.map(d => d.cachedTokens);
  $: netInputData = filteredDays.map(d => d.inputTokens);
  $: outputData = filteredDays.map(d => d.outputTokens);
  
  $: chartData = {
    labels,
    datasets: [
      {
        label: 'Cached Input',
        data: cachedData,
        backgroundColor: 'rgba(79, 195, 247, 0.55)',
        borderColor: 'rgba(79, 195, 247, 0.8)',
        borderWidth: 1,
        borderRadius: 3,
        stack: 'input',
      },
      {
        label: 'Net Input',
        data: netInputData,
        backgroundColor: 'rgba(79, 195, 247, 0.25)',
        borderColor: 'rgba(79, 195, 247, 0.4)',
        borderWidth: 1,
        borderRadius: 3,
        stack: 'input',
      },
      {
        label: 'Output',
        data: outputData,
        backgroundColor: 'rgba(129, 199, 132, 0.75)',
        borderColor: 'rgba(129, 199, 132, 0.9)',
        borderWidth: 1,
        borderRadius: 3,
        stack: 'output',
      },
    ]
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
        stacked: true,
        ticks: {
          ...baseScaleConfig.ticks,
          maxTicksLimit: 8,
        },
        grid: baseScaleConfig.grid,
      },
      y: {
        stacked: false,
        title: {
          display: true,
          text: 'Tokens',
          color: baseScaleConfig.ticks.color,
          font: { size: baseScaleConfig.ticks.font.size },
        },
        grid: baseScaleConfig.grid,
        ticks: baseScaleConfig.ticks,
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
          pointStyle: 'rect',
        },
      },
      tooltip: tooltipConfig,
    },
  };
</script>

<div class="token-trend-chart">
  <ChartWrapper 
    type="bar"
    data={chartData}
    options={chartOptions}
    canvasId="tokenTrendChart"
  />
</div>

<style>
  .token-trend-chart {
    height: 300px;
    position: relative;
  }
</style>
