<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import ChartWrapper from '../shared/ChartWrapper.svelte';
  
  $: agentBreakdown = $dashboardData?.agentBreakdown ?? [];
  
  const AGENT_LABEL_MAP: Record<string, string> = {
    'GitHub Copilot Chat': 'Sidebar Chat',
    'panel/editAgent': 'Inline Chat',
    'XtabProvider': 'Next Edit Suggestions',
    'summarizeConversationHistory': 'Context Summarization',
    'progressMessages': 'Background Processing',
    'title': 'Title Generation',
  };
  
  $: filteredAgents = agentBreakdown
    .filter(a => a.totalCostUsd > 0)
    .slice(0, 8);
  
  $: labels = filteredAgents.map(a => AGENT_LABEL_MAP[a.agentName] ?? a.agentName ?? 'Other');
  $: costData = filteredAgents.map(a => a.totalCostUsd);
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
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
            const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
            return `${label}: $${value.toFixed(3)} (${pct}%)`;
          }
        }
      }
    },
  };
  
  $: hasData = filteredAgents.length > 0;
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
