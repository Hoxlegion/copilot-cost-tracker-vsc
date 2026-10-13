<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import ChartWrapper from '../shared/ChartWrapper.svelte';
  import { tooltipConfig, baseScaleConfig, LEGEND_COLOR } from '../../utils/chartStyles';
  import { CONTEXT_TIER_LABELS, CONTEXT_TIER_THRESHOLDS, classifyContextTier, type ContextTier } from '../../../shared/contextTiers';
  
  $: allDistribution = $dashboardData?.contextDistribution ?? [];
  
  $: contextDistribution = allDistribution.filter(d => {
    if ($filterState.fromMs !== null && d.startMs < $filterState.fromMs) return false;
    if ($filterState.toMs !== null && d.startMs > $filterState.toMs) return false;
    return true;
  });
  
  const k = (tokens: number) => `${tokens / 1000}K`;
  const { moderate, heavy, critical } = CONTEXT_TIER_THRESHOLDS;
  const TIERS: Array<{ tier: ContextTier; range: string; rgb: string }> = [
    { tier: 'light', range: `0-${k(moderate)}`, rgb: '129, 199, 132' },
    { tier: 'moderate', range: `${k(moderate)}-${k(heavy)}`, rgb: '255, 183, 77' },
    { tier: 'heavy', range: `${k(heavy)}-${k(critical)}`, rgb: '255, 138, 101' },
    { tier: 'critical', range: `${k(critical)}+`, rgb: '229, 115, 115' },
  ];
  
  $: chartData = {
    datasets: TIERS.map(({ tier, range, rgb }) => ({
      label: `${CONTEXT_TIER_LABELS[tier]} (${range})`,
      data: contextDistribution
        .filter(d => classifyContextTier(d.currentContextWeight) === tier)
        .map(d => ({ x: d.turnCount, y: d.currentContextWeight })),
      backgroundColor: `rgba(${rgb}, 0.7)`,
      borderColor: `rgba(${rgb}, 1)`,
      pointRadius: 5,
      pointHoverRadius: 7,
    })),
  };
  
  $: chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'linear' as const,
        title: {
          display: true,
          text: 'Turns in Session',
          color: baseScaleConfig.ticks.color,
          font: { size: baseScaleConfig.ticks.font.size },
        },
        grid: baseScaleConfig.grid,
        ticks: baseScaleConfig.ticks,
      },
      y: {
        type: 'linear' as const,
        title: {
          display: true,
          text: 'Context Weight (tokens)',
          color: baseScaleConfig.ticks.color,
          font: { size: baseScaleConfig.ticks.font.size },
        },
        grid: baseScaleConfig.grid,
        ticks: {
          ...baseScaleConfig.ticks,
          callback: function(value: number) {
            if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
            return value;
          },
        },
      },
    },
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: {
          color: LEGEND_COLOR,
          font: { size: 11 },
          usePointStyle: true,
          pointStyle: 'circle',
        },
      },
      tooltip: {
        ...tooltipConfig,
        callbacks: {
          label: function(context: any) {
            const tokens = context.parsed.y;
            const turns = context.parsed.x;
            const pages = Math.round(tokens / 2500);
            return `${turns} turns · ${tokens.toLocaleString()} tokens (~${pages} pages)`;
          },
        },
      },
      annotation: {
        annotations: {
          lineModerate: {
            type: 'line',
            yMin: moderate,
            yMax: moderate,
            borderColor: 'rgba(129, 199, 132, 0.3)',
            borderWidth: 1,
            borderDash: [5, 5],
          },
          lineHeavy: {
            type: 'line',
            yMin: heavy,
            yMax: heavy,
            borderColor: 'rgba(255, 183, 77, 0.3)',
            borderWidth: 1,
            borderDash: [5, 5],
          },
          lineCritical: {
            type: 'line',
            yMin: critical,
            yMax: critical,
            borderColor: 'rgba(229, 115, 115, 0.3)',
            borderWidth: 1,
            borderDash: [5, 5],
          },
        },
      },
    },
  };
</script>

<div class="context-scatter-chart">
  <ChartWrapper 
    type="scatter"
    data={chartData}
    options={chartOptions}
    canvasId="contextScatterChart"
  />
</div>

<style>
  .context-scatter-chart {
    height: 300px;
    position: relative;
  }
</style>
