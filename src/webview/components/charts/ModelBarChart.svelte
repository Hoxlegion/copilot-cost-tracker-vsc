<script lang="ts">
  import { tooltipConfig, baseScaleConfig } from '../../utils/chartStyles';
  import { filteredSessions } from '../../stores/filteredSessions';
  import { aggregateModelsFromSessions } from '../../utils/modelAggregation';
  import { CHART_COLORS } from '../../utils/palette';
  import ChartWrapper from '../shared/ChartWrapper.svelte';

  $: filteredModelBreakdown = aggregateModelsFromSessions($filteredSessions).filter(m => m.totalCostUsd > 0);

  $: labels = filteredModelBreakdown.map(m => m.model);
  $: costData = filteredModelBreakdown.map(m => m.totalCostUsd);
  $: colors = CHART_COLORS;
  
  $: chartData = {
    labels,
    datasets: [{
      label: 'Cost (USD)',
      data: costData,
      backgroundColor: colors.slice(0, labels.length).map(c => c + 'cc'),
      borderColor: colors.slice(0, labels.length),
      borderWidth: 1,
      borderRadius: 4,
    }]
  };
  
  $: chartOptions = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: tooltipConfig,
    },
    scales: {
      x: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'Cost (USD)',
          color: baseScaleConfig.ticks.color,
          font: { size: baseScaleConfig.ticks.font.size },
        },
        grid: baseScaleConfig.grid,
        ticks: baseScaleConfig.ticks,
      },
      y: {
        grid: { display: false },
        ticks: {
          ...baseScaleConfig.ticks,
          font: { size: 11 },
        },
      },
    },
  };
</script>

<div class="model-bar-chart">
  <ChartWrapper 
    type="bar"
    data={chartData}
    options={chartOptions}
    canvasId="modelBarChart"
  />
</div>

<style>
  .model-bar-chart {
    height: 300px;
    position: relative;
  }
</style>
