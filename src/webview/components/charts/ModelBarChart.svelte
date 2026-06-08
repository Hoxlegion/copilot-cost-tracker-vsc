<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import ChartWrapper from '../shared/ChartWrapper.svelte';
  import { tooltipConfig, baseScaleConfig } from '../../utils/chartStyles';
  
  $: allSessions = $dashboardData?.allSessions ?? [];
  
  $: filteredSessions = allSessions.filter(s => {
    if ($filterState.fromMs !== null && s.startTimestamp < $filterState.fromMs) return false;
    if ($filterState.toMs !== null && s.startTimestamp > $filterState.toMs) return false;
    return true;
  });
  
  $: filteredModelBreakdown = (() => {
    const modelMap = new Map<string, {
      model: string;
      totalCostUsd: number;
    }>();
    
    filteredSessions.forEach(s => {
      const current = modelMap.get(s.primaryModel) ?? {
        model: s.primaryModel,
        totalCostUsd: 0,
      };
      current.totalCostUsd += s.totalCostUsd;
      modelMap.set(s.primaryModel, current);
    });
    
    return Array.from(modelMap.values())
      .filter(m => m.totalCostUsd > 0)
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  })();
  
  $: labels = filteredModelBreakdown.map(m => m.model);
  $: costData = filteredModelBreakdown.map(m => m.totalCostUsd);
  $: colors = ['#4fc3f7', '#81c784', '#ffb74d', '#e57373', '#ba68c8', '#4db6ac', '#fff176', '#90a4ae'];
  
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
