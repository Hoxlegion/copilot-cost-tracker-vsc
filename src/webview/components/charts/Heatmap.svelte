<script lang="ts">
  import { dashboardData, formatUsd } from '../../stores/dashboard';
  
  let heatmapMode: 'cost' | 'turns' = 'cost';
  let hoveredCell: { date: string; value: number } | null = null;
  
  $: dailyCosts = $dashboardData?.dailyCostsForRange ?? [];
  
  $: heatmapData = (() => {
    const data = new Map<string, { cost: number; turns: number }>();
    
    dailyCosts.forEach(d => {
      data.set(d.period, { cost: d.totalCostUsd, turns: d.turnCount });
    });
    
    const days: Array<{ date: string; cost: number; turns: number }> = [];
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset - 51 * 7);
    
    for (let i = 0; i < 364; i++) {
      const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const key = date.toISOString().slice(0, 10);
      const dayData = data.get(key) || { cost: 0, turns: 0 };
      days.push({ date: key, ...dayData });
    }
    
    return days;
  })();
  
  $: maxValue = Math.max(
    ...heatmapData.map(d => heatmapMode === 'cost' ? d.cost : d.turns),
    0.001
  );
  
  $: weeks = (() => {
    const result: Array<Array<{ date: string; cost: number; turns: number }>> = [];
    for (let i = 0; i < heatmapData.length; i += 7) {
      result.push(heatmapData.slice(i, i + 7));
    }
    return result;
  })();
  
  $: monthLabels = (() => {
    const labels: Array<{ label: string; weekIndex: number }> = [];
    let lastMonth = -1;
    
    weeks.forEach((week, weekIndex) => {
      if (week.length > 0) {
        const d = new Date(week[0].date + 'T00:00:00');
        const month = d.getMonth();
        if (month !== lastMonth) {
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          labels.push({ label: monthNames[month], weekIndex });
          lastMonth = month;
        }
      }
    });
    
    return labels;
  })();
  
  function getColorIntensity(value: number): string {
    const intensity = value / maxValue;
    if (intensity === 0) return 'var(--vscode-panel-border)';
    if (intensity < 0.25) return '#0e4429';
    if (intensity < 0.5) return '#006d32';
    if (intensity < 0.75) return '#26a641';
    return '#39d353';
  }
  
  function handleCellHover(date: string, value: number) {
    hoveredCell = { date, value };
  }
  
  function handleCellLeave() {
    hoveredCell = null;
  }
</script>

<div class="heatmap">
  <div class="heatmap-header">
    <h3>Activity Heatmap</h3>
    <div class="mode-toggle">
      <button 
        class:active={heatmapMode === 'cost'}
        on:click={() => heatmapMode = 'cost'}
      >
        Cost
      </button>
      <button 
        class:active={heatmapMode === 'turns'}
        on:click={() => heatmapMode = 'turns'}
      >
        Turns
      </button>
    </div>
  </div>
  
  <div class="heatmap-container">
    <div class="heatmap-scroll">
      <div class="heatmap-months">
        {#each monthLabels as { label, weekIndex }}
          <span style="left: calc({weekIndex} * var(--cell-size) + {weekIndex} * var(--cell-gap) + 30px)">{label}</span>
        {/each}
      </div>
      
      <div class="heatmap-grid">
        <div class="day-labels">
          <span>Mon</span>
          <span></span>
          <span>Wed</span>
          <span></span>
          <span>Fri</span>
          <span></span>
          <span></span>
        </div>
        
        <div class="weeks">
          {#each weeks as week}
            <div class="week">
              {#each week as day}
                {@const value = heatmapMode === 'cost' ? day.cost : day.turns}
                <div 
                  class="cell"
                  role="img"
                  aria-label="{day.date}: {heatmapMode === 'cost' ? $formatUsd(value) : `${value} turns`}"
                  style="background: {getColorIntensity(value)}"
                  on:mouseenter={() => handleCellHover(day.date, value)}
                  on:mouseleave={handleCellLeave}
                ></div>
              {/each}
            </div>
          {/each}
        </div>
      </div>
    </div>
    
    <div class="heatmap-legend">
      <span>None</span>
      <div class="legend-cell" style="background: var(--vscode-panel-border)"></div>
      <div class="legend-cell" style="background: #0e4429"></div>
      <div class="legend-cell" style="background: #006d32"></div>
      <div class="legend-cell" style="background: #26a641"></div>
      <div class="legend-cell" style="background: #39d353"></div>
      <span>High</span>
    </div>
    
    {#if hoveredCell}
      <div class="tooltip">
        {hoveredCell.date}: {heatmapMode === 'cost' ? $formatUsd(hoveredCell.value) : `${hoveredCell.value} turns`}
      </div>
    {/if}
  </div>
</div>

<style>
  .heatmap {
    background: color-mix(in srgb, var(--vscode-editorWidget-background) 78%, #103449 22%);
    border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, #2aa5ff 30%);
    border-radius: 10px;
    padding: 16px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.16);
  }
  
  .heatmap-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }
  
  .heatmap-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }
  
  .mode-toggle {
    display: flex;
    gap: 4px;
  }
  
  .mode-toggle button {
    padding: 4px 12px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-button-border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s ease;
  }
  
  .mode-toggle button:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  
  .mode-toggle button.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  
  .heatmap-container {
    position: relative;
    --cell-size: 11px;
    --cell-gap: 2px;
  }
  
  .heatmap-scroll {
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 4px;
  }
  
  .heatmap-scroll::-webkit-scrollbar {
    height: 6px;
  }
  
  .heatmap-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  
  .heatmap-scroll::-webkit-scrollbar-thumb {
    background: var(--vscode-scrollbarSlider-background);
    border-radius: 3px;
  }
  
  .heatmap-months {
    position: relative;
    height: 18px;
    margin-bottom: 4px;
    margin-left: 30px;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    min-width: calc(52 * (var(--cell-size) + var(--cell-gap)));
  }
  
  .heatmap-months span {
    position: absolute;
  }
  
  .heatmap-grid {
    display: flex;
    gap: 4px;
    min-width: calc(52 * (var(--cell-size) + var(--cell-gap)));
  }
  
  .day-labels {
    display: flex;
    flex-direction: column;
    gap: var(--cell-gap);
    width: 26px;
    flex-shrink: 0;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
  }
  
  .day-labels span {
    height: var(--cell-size);
    line-height: var(--cell-size);
  }
  
  .weeks {
    display: flex;
    gap: var(--cell-gap);
    flex: 1;
  }
  
  .week {
    display: flex;
    flex-direction: column;
    gap: var(--cell-gap);
  }
  
  .cell {
    width: var(--cell-size);
    height: var(--cell-size);
    border-radius: 2px;
    cursor: pointer;
    transition: opacity 0.15s ease, transform 0.15s ease;
  }
  
  .cell:hover {
    opacity: 0.8;
    transform: scale(1.2);
  }
  
  .heatmap-legend {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 12px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  
  .legend-cell {
    width: var(--cell-size);
    height: var(--cell-size);
    border-radius: 2px;
  }
  
  .tooltip {
    position: absolute;
    bottom: -30px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(30, 30, 30, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    white-space: nowrap;
    z-index: 10;
    pointer-events: none;
  }
</style>
