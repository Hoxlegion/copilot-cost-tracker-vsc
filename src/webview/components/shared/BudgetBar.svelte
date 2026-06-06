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
    background: var(--vscode-panel-border);
    border-radius: 3px;
    margin-top: 6px;
    overflow: hidden;
  }
  
  .budget-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.3s ease;
  }
</style>
