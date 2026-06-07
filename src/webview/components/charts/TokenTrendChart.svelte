<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import ChartWrapper from '../shared/ChartWrapper.svelte';
  
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
        stack: 'input',
      },
      {
        label: 'Net Input',
        data: netInputData,
        backgroundColor: 'rgba(79, 195, 247, 0.25)',
        stack: 'input',
      },
      {
        label: 'Output',
        data: outputData,
        backgroundColor: 'rgba(129, 199, 132, 0.75)',
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
          maxTicksLimit: 8,
        },
      },
      y: {
        stacked: false,
        title: {
          display: true,
          text: 'Tokens',
        },
      },
    },
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
      },
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
