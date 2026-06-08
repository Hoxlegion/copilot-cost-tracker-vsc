<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import ChartWrapper from '../shared/ChartWrapper.svelte';
  import { tooltipConfig } from '../../utils/chartStyles';
  
  $: agentBreakdown = $dashboardData?.agentBreakdown ?? [];
  $: dailyAgentBreakdown = $dashboardData?.dailyAgentBreakdown ?? [];
  
  const AGENT_LABEL_MAP: Record<string, string> = {
    'GitHub Copilot Chat': 'Sidebar Chat',
    'panel/editAgent': 'Inline Chat',
    'XtabProvider': 'Next Edit Suggestions',
    'summarizeConversationHistory': 'Context Summarization',
    'progressMessages': 'Background Processing',
    'title': 'Title Generation',
  };
  
  $: filteredAgentBreakdown = (() => {
    const agentMap = new Map<string, {
      agentName: string;
      totalCostUsd: number;
      totalCredits: number;
      turnCount: number;
    }>();
    
    dailyAgentBreakdown.forEach(day => {
      const dayTs = new Date(day.period + 'T00:00:00').getTime();
      const dayEndTs = dayTs + 86400000 - 1;
      
      if ($filterState.fromMs !== null && dayEndTs < $filterState.fromMs) return;
      if ($filterState.toMs !== null && dayTs > $filterState.toMs) return;
      
      const current = agentMap.get(day.agentName) ?? {
        agentName: day.agentName,
        totalCostUsd: 0,
        totalCredits: 0,
        turnCount: 0,
      };
      current.totalCostUsd += day.totalCostUsd;
      current.totalCredits += day.totalCredits;
      current.turnCount += day.turnCount;
      agentMap.set(day.agentName, current);
    });
    
    const agents = Array.from(agentMap.values());
    const totalCost = agents.reduce((sum, a) => sum + a.totalCostUsd, 0);
    
    return agents.map(a => ({
      ...a,
      percentage: totalCost > 0 ? (a.totalCostUsd / totalCost) * 100 : 0,
    })).sort((a, b) => b.totalCostUsd - a.totalCostUsd).slice(0, 8);
  })();
  
  $: labels = filteredAgentBreakdown.map(a => AGENT_LABEL_MAP[a.agentName] ?? a.agentName ?? 'Other');
  $: costData = filteredAgentBreakdown.map(a => a.totalCostUsd);
  $: colors = ['#4fc3f7', '#81c784', '#ffb74d', '#e57373', '#ba68c8', '#4db6ac', '#fff176', '#90a4ae'];
  
  $: chartData = {
    labels,
    datasets: [{
      label: 'Cost (USD)',
      data: costData,
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
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
            const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
            return `${label}: $${value.toFixed(2)} (${pct}%)`;
          }
        }
      }
    },
  };
  
  $: hasData = filteredAgentBreakdown.length > 0;
</script>

{#if hasData}
  <div class="surface-pie-chart">
    <ChartWrapper 
      type="doughnut"
      data={chartData}
      options={chartOptions}
      canvasId="surfacePieChart"
    />
  </div>
{:else}
  <div class="no-data">
    <span>No data yet</span>
  </div>
{/if}

<style>
  .surface-pie-chart {
    height: 300px;
    position: relative;
  }
  
  .no-data {
    height: 300px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }
</style>
