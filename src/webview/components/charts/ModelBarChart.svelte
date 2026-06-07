<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import ChartWrapper from '../shared/ChartWrapper.svelte';
  
  $: modelBreakdown = $dashboardData?.modelBreakdown ?? [];
  
  $: filteredModels = modelBreakdown.filter(m => m.totalCostUsd > 0);
  
  $: labels = filteredModels.map(m => m.model);
  $: costData = filteredModels.map(m => m.totalCostUsd);
  $: colors = ['#4fc3f7', '#81c784', '#ffb74d', '#e57373', '#ba68c8', '#4db6ac', '#fff176', '#90a4ae'];
  
  $: chartData = {
    labels,
    datasets: [{
      label: 'Cost (USD)',
      data: costData,
      backgroundColor: colors.slice(0, labels.length),
      borderColor: colors.slice(0, labels.length),
      borderWidth: 1,
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
    },
    scales: {
      x: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'Cost (USD)',
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
