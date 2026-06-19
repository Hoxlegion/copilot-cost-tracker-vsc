<script lang="ts">
  import { filterState, applyPreset, applyCustomRange, resetFilter, type FilterPreset } from '../../stores/filter';
  import { dashboardData } from '../../stores/dashboard';
  
  $: billingPeriodStartMs = $dashboardData?.billingPeriodStartMs ?? 0;
  $: lastUpdatedMs = $dashboardData?.lastUpdatedMs ?? Date.now();
  
  let customFrom = '';
  let customTo = '';
  
  function handlePresetClick(preset: FilterPreset) {
    applyPreset(preset, billingPeriodStartMs);
  }
  
  function handleApply() {
    const fromMs = customFrom ? new Date(customFrom).getTime() : null;
    const toMs = customTo ? new Date(customTo).getTime() : null;
    applyCustomRange(fromMs, toMs);
  }
  
  function handleReset() {
    resetFilter(billingPeriodStartMs);
    customFrom = '';
    customTo = '';
  }
  
  function formatFreshnessLabel(lastUpdatedMs: number): string {
    if (!lastUpdatedMs || !Number.isFinite(lastUpdatedMs)) return 'no data';
    const diffMs = Math.max(0, Date.now() - lastUpdatedMs);
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
  
  $: freshnessLabel = formatFreshnessLabel(lastUpdatedMs);
</script>

<div class="global-filter">
  <div class="filter-controls">
    <div class="preset-buttons">
      <button 
        class:active={$filterState.preset === 'today'}
        on:click={() => handlePresetClick('today')}
      >
        Today
      </button>
      <button 
        class:active={$filterState.preset === '7d'}
        on:click={() => handlePresetClick('7d')}
      >
        7d
      </button>
      <button 
        class:active={$filterState.preset === '30d'}
        on:click={() => handlePresetClick('30d')}
      >
        30d
      </button>
      <button 
        class:active={$filterState.preset === 'period'}
        on:click={() => handlePresetClick('period')}
      >
        This Period
      </button>
    </div>
    
    <div class="custom-range">
      <input 
        type="datetime-local" 
        bind:value={customFrom}
        placeholder="From"
      />
      <span class="separator">to</span>
      <input 
        type="datetime-local" 
        bind:value={customTo}
        placeholder="To"
      />
      <button on:click={handleApply}>Apply</button>
      <button on:click={handleReset}>Reset</button>
    </div>
  </div>
  
  <div class="freshness-indicator">
    Updated: {freshnessLabel}
  </div>
</div>

<style>
  .global-filter {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 16px;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border);
    gap: 12px;
  }
  
  .filter-controls {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
  
  .preset-buttons {
    display: flex;
    gap: 2px;
    background: var(--vscode-input-background);
    border-radius: 8px;
    padding: 2px;
    border: 1px solid var(--vscode-panel-border);
  }
  
  .preset-buttons button {
    padding: 4px 14px;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    transition: all 0.15s ease;
  }
  
  .preset-buttons button:hover {
    background: var(--vscode-list-hoverBackground);
    color: var(--vscode-editor-foreground);
  }
  
  .preset-buttons button.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    font-weight: 600;
  }
  
  .custom-range {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  
  .custom-range input {
    padding: 4px 8px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 6px;
    font-size: 11px;
  }
  
  .custom-range .separator {
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }
  
  .custom-range button {
    padding: 4px 12px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-button-border);
    border-radius: 6px;
    cursor: pointer;
    font-size: 11px;
  }
  
  .custom-range button:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  
  .freshness-indicator {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
  }
</style>
