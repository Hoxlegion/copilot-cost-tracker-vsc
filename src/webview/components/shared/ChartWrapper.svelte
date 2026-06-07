<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Chart, registerables } from 'chart.js';
  
  Chart.register(...registerables);
  
  export let type: 'line' | 'bar' | 'doughnut' | 'pie';
  export let data: any;
  export let options: any = {};
  export let canvasId: string;
  
  let chart: Chart | null = null;
  let canvas: HTMLCanvasElement;
  
  onMount(() => {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      chart = new Chart(ctx, {
        type,
        data,
        options,
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
