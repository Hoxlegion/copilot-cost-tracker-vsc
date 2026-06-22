<script lang="ts">
  import { tooltipConfig, LEGEND_COLOR } from '../../utils/chartStyles';
  import { filteredSessions } from '../../stores/filteredSessions';
  import { aggregateModelsFromSessions } from '../../utils/modelAggregation';
  import { CHART_COLORS } from '../../utils/palette';
  import ChartWrapper from '../shared/ChartWrapper.svelte';

  $: filteredModelBreakdown = aggregateModelsFromSessions($filteredSessions).filter(m => m.totalCostUsd > 0);

  $: labels = filteredModelBreakdown.map(m => m.model);
  $: percentageData = filteredModelBreakdown.map(m => m.percentage);
  $: colors = CHART_COLORS;
  
  $: chartData = {
    labels,
    datasets: [{
      label: 'Percentage',
      data: percentageData,
      backgroundColor: colors.slice(0, labels.length).map(c => c + 'cc'),
      borderColor: 'rgba(0, 0, 0, 0.3)',
      borderWidth: 2,
      hoverOffset: 8,
    }]
  };
  
  $: chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'right' as const,
        labels: {
          color: LEGEND_COLOR,
          font: { size: 11 },
          usePointStyle: true,
          pointStyle: 'circle',
          padding: 12,
        },
      },
      tooltip: {
        ...tooltipConfig,
        callbacks: {
          label: (context: any) => {
            const label = context.label || '';
            const value = context.parsed || 0;
            return `${label}: ${value.toFixed(1)}%`;
          }
        }
      }
    },
  };
</script>

<div class="model-pie-chart">
  <ChartWrapper 
    type="doughnut"
    data={chartData}
    options={chartOptions}
    canvasId="modelPieChart"
  />
</div>

<style>
  .model-pie-chart {
    height: 300px;
    position: relative;
  }
</style>
