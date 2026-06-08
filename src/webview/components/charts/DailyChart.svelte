<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import ChartWrapper from '../shared/ChartWrapper.svelte';
  import { tooltipConfig, baseScaleConfig } from '../../utils/chartStyles';
  
  let chartMode: 'cost' | 'tokens' = 'cost';
  
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
  $: creditsData = sortedData.map(d => d.totalCredits);
  $: turnsData = sortedData.map(d => d.turnCount);
  
  $: chartData = chartMode === 'cost' ? {
    labels,
    datasets: [
      {
        label: 'Cost (USD)',
        data: costData,
        borderColor: '#4fc3f7',
        backgroundColor: 'rgba(79, 195, 247, 0.1)',
        fill: true,
        yAxisID: 'y',
        tension: 0.4,
        pointRadius: 2,
        pointHoverRadius: 5,
      },
      {
        label: 'Credits',
        data: creditsData,
        borderColor: '#81c784',
        backgroundColor: 'rgba(129, 199, 132, 0.1)',
        fill: true,
        yAxisID: 'y1',
        tension: 0.4,
        pointRadius: 2,
        pointHoverRadius: 5,
      }
    ]
  } : {
    labels,
    datasets: [
      {
        label: 'Turns',
        data: turnsData,
        borderColor: '#ffb74d',
        backgroundColor: 'rgba(255, 183, 77, 0.1)',
        fill: true,
        yAxisID: 'y',
        tension: 0.4,
        pointRadius: 2,
        pointHoverRadius: 5,
      }
    ]
  };
  
  $: gradientColors = chartMode === 'cost' 
    ? [{ color: '#4fc3f7', startAlpha: 0.3, endAlpha: 0 }, { color: '#81c784', startAlpha: 0.2, endAlpha: 0 }]
    : [{ color: '#ffb74d', startAlpha: 0.3, endAlpha: 0 }];
  
  $: chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    scales: chartMode === 'cost' ? {
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
        title: {
          display: true,
          text: 'Credits',
          color: baseScaleConfig.ticks.color,
          font: { size: baseScaleConfig.ticks.font.size },
        },
        grid: {
          drawOnChartArea: false,
        },
        ticks: baseScaleConfig.ticks,
      },
    } : {
      y: {
        type: 'linear' as const,
        display: true,
        position: 'left' as const,
        title: {
          display: true,
          text: 'Turns',
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
    <div class="mode-toggle">
      <button 
        class:active={chartMode === 'cost'}
        on:click={() => chartMode = 'cost'}
      >
        Cost/Credits
      </button>
      <button 
        class:active={chartMode === 'tokens'}
        on:click={() => chartMode = 'tokens'}
      >
        Turns
      </button>
    </div>
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
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 16px;
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
  
  .mode-toggle {
    display: flex;
    gap: 4px;
  }
  
  .mode-toggle button {
    padding: 4px 12px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-button-border);
    border-radius: 2px;
    cursor: pointer;
    font-size: 12px;
  }
  
  .mode-toggle button:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  
  .mode-toggle button.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  
  .chart-container {
    height: 300px;
    position: relative;
  }
</style>
