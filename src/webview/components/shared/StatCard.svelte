<script lang="ts">
  export let label: string;
  export let value: string | number = '';
  export let sub: string = '';
  export let valueColor: string = '';
  export let icon: string = '';
</script>

<div class="stat">
  <div class="stat-header">
    {#if icon}
      <span class="stat-icon">{icon}</span>
    {/if}
    <div class="stat-label">{label}</div>
  </div>
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
    background: color-mix(in srgb, var(--vscode-editorWidget-background) 78%, #103449 22%);
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, #2aa5ff 30%);
    border-radius: 10px;
    padding: 12px 14px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.16);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }
  
  .stat:hover {
    transform: translateY(-1px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  }
  
  .stat-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  
  .stat-icon {
    font-size: 14px;
    opacity: 0.7;
  }
  
  .stat-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.35px;
    font-weight: 500;
  }
  
  .stat-value {
    font-size: 22px;
    font-weight: 700;
    margin-top: 2px;
    color: var(--vscode-editor-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  
  .stat-sub {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-top: 4px;
  }
</style>
