<script lang="ts">
  export let label: string;
  export let value: string | number = '';
  export let sub: string = '';
  export let valueColor: string = '';
</script>

<div class="stat">
  <div class="stat-label">{label}</div>
  {#if value}
    <div class="stat-value" style={valueColor ? `color: ${valueColor}` : ''}>
      {value}
    </div>
  {/if}
  {#if sub}
    <div class="stat-sub">{sub}</div>
  {/if}
  <slot />
</div>

<style>
  .stat {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 10px 12px;
  }
  
  .stat-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .stat-value {
    font-size: 20px;
    font-weight: 700;
    margin-top: 2px;
  }
  
  .stat-sub {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-top: 1px;
  }
</style>
