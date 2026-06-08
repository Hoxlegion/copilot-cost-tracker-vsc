<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import ChartWrapper from '../shared/ChartWrapper.svelte';
  import { tooltipConfig } from '../../utils/chartStyles';
  
  $: modelBreakdown = $dashboardData?.modelBreakdown ?? [];
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
      totalCredits: number;
      turnCount: number;
    }>();
    
    filteredSessions.forEach(s => {
      const current = modelMap.get(s.primaryModel) ?? {
        model: s.primaryModel,
        totalCostUsd: 0,
        totalCredits: 0,
        turnCount: 0,
      };
      current.totalCostUsd += s.totalCostUsd;
      current.totalCredits += s.totalCredits;
      current.turnCount += s.turnCount;
      modelMap.set(s.primaryModel, current);
    });
    
    const models = Array.from(modelMap.values());
    const totalCost = models.reduce((sum, m) => sum + m.totalCostUsd, 0);
    
    return models.map(m => ({
      ...m,
      percentage: totalCost > 0 ? (m.totalCostUsd / totalCost) * 100 : 0,
    })).sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  })();
  
  $: labels = filteredModelBreakdown.map(m => m.model);
  $: percentageData = filteredModelBreakdown.map(m => m.percentage);
  $: colors = ['#4fc3f7', '#81c784', '#ffb74d', '#e57373', '#ba68c8', '#4db6ac', '#fff176', '#90a4ae'];
  
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
          color: 'rgba(255, 255, 255, 0.7)',
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
