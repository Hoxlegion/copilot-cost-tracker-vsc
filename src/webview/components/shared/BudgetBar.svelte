<script lang="ts">
  export let percentage: number;
  export let color: string = 'var(--vscode-progressBar-background)';
</script>

<div class="budget-bar">
  <div class="budget-fill" style="width: {Math.min(100, percentage)}%; background: {color}"></div>
</div>

<style>
  .budget-bar {
    width: 100%;
    height: 6px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 3px;
    margin-top: 6px;
    overflow: hidden;
  }
  
  .budget-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.4s ease;
    box-shadow: 0 0 6px rgba(0, 0, 0, 0.2);
  }
</style>
