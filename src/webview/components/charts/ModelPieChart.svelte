<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import ChartWrapper from '../shared/ChartWrapper.svelte';
  
  $: modelBreakdown = $dashboardData?.modelBreakdown ?? [];
  
  $: filteredModels = modelBreakdown.filter(m => m.totalCostUsd > 0);
  
  $: labels = filteredModels.map(m => m.model);
  $: percentageData = filteredModels.map(m => m.percentage);
  $: colors = ['#4fc3f7', '#81c784', '#ffb74d', '#e57373', '#ba68c8', '#4db6ac', '#fff176', '#90a4ae'];
  
  $: chartData = {
    labels,
    datasets: [{
      label: 'Percentage',
      data: percentageData,
      backgroundColor: colors.slice(0, labels.length),
      borderColor: colors.slice(0, labels.length),
      borderWidth: 1,
    }]
  };
  
  $: chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'right' as const,
      },
      tooltip: {
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
