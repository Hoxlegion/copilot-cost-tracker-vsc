<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Chart, registerables, type Plugin } from 'chart.js';
  import { createGradient } from '../../utils/chartStyles';
  
  Chart.register(...registerables);
  
  export let type: 'line' | 'bar' | 'doughnut' | 'pie' | 'scatter';
  export let data: any;
  export let options: any = {};
  export let canvasId: string;
  export let gradientColors: Array<{ color: string; startAlpha?: number; endAlpha?: number }> = [];
  
  let chart: Chart | null = null;
  let canvas: HTMLCanvasElement;
  
  const gradientPlugin: Plugin = {
    id: 'gradientFill',
    beforeDraw: (chart) => {
      if (gradientColors.length === 0) return;
      const ctx = chart.ctx;
      const chartArea = chart.chartArea;
      if (!chartArea) return;
      
      chart.data.datasets.forEach((dataset, i) => {
        if (gradientColors[i]) {
          const { color, startAlpha = 0.4, endAlpha = 0 } = gradientColors[i];
          dataset.backgroundColor = createGradient(ctx, chartArea, color, startAlpha, endAlpha);
        }
      });
    }
  };
  
  onMount(() => {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      chart = new Chart(ctx, {
        type,
        data,
        options,
        plugins: gradientColors.length > 0 ? [gradientPlugin] : [],
      });
    }
  });
  
  $: if (chart && data) {
    chart.data = data;
    chart.update();
  }
  
  $: if (chart && options) {
    chart.options = options;
    chart.update();
  }
  
  onDestroy(() => {
    if (chart) {
      chart.destroy();
    }
  });
</script>

<canvas bind:this={canvas} id={canvasId}></canvas>
