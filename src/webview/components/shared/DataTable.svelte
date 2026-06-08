<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  
  export let columns: Array<{ 
    key: string; 
    label: string; 
    type?: 'string' | 'number' | 'percentage';
    primary?: boolean;
    muted?: boolean;
    highlight?: boolean;
  }>;
  export let rows: Record<string, unknown>[];
  export let sortable = true;
  export let expandable = false;
  export let rowId: (row: Record<string, unknown>) => string = (row) => String(row.id ?? '');
  
  const dispatch = createEventDispatcher();
  
  let sortKey = '';
  let sortDir: 'asc' | 'desc' = 'desc';
  let expandedRows = new Set<string>();
  
  function handleSort(key: string) {
    if (!sortable) return;
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'desc';
    }
    dispatch('sort', { key: sortKey, dir: sortDir });
  }
  
  function toggleRow(id: string) {
    if (expandedRows.has(id)) {
      expandedRows.delete(id);
    } else {
      expandedRows.add(id);
    }
    expandedRows = expandedRows;
  }
  
  $: sortedRows = (() => {
    if (!sortKey) return rows;
    const col = columns.find(c => c.key === sortKey);
    const isNumber = col?.type === 'number' || col?.type === 'percentage';
    return [...rows].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (isNumber) {
        return sortDir === 'asc' 
          ? Number(aVal) - Number(bVal) 
          : Number(bVal) - Number(aVal);
      }
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  })();
  
  $: primaryColIndex = columns.findIndex(c => c.primary || c.type === 'string');
</script>

<table>
  <thead>
    <tr>
      {#if expandable}
        <th class="expand-col"></th>
      {/if}
      {#each columns as col, i}
        <th 
          class:sortable={sortable}
          class:num={col.type === 'number' || col.type === 'percentage'}
          on:click={() => handleSort(col.key)}
        >
          {col.label}
          {#if sortKey === col.key}
            <span class="sort-indicator">{sortDir === 'asc' ? '↑' : '↓'}</span>
          {/if}
        </th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each sortedRows as row, rowIndex}
      {@const id = rowId(row)}
      {@const isExpanded = expandedRows.has(id)}
      <tr class:expanded={isExpanded}>
        {#if expandable}
          <td class="expand-col">
            <button class="expand-button" on:click={() => toggleRow(id)}>
              {isExpanded ? '▼' : '▶'}
            </button>
          </td>
        {/if}
        {#each columns as col, i}
          <td 
            class:num={col.type === 'number' || col.type === 'percentage'}
            class:primary={col.primary || (primaryColIndex === i && col.type === 'string')}
            class:muted={col.muted}
            class:highlight={col.highlight && row[col.key] !== '0.00' && row[col.key] !== '$0.00'}
            class:zero={row[col.key] === '0.00' || row[col.key] === '$0.00' || row[col.key] === 0}
          >
            {#if col.type === 'percentage'}
              <div class="pct-cell">
                <div class="pct-bar" style="width: {Math.min(100, Number(row[col.key]))}%"></div>
                <span class="pct-value">{row[col.key]}%</span>
              </div>
            {:else}
              {row[col.key]}
            {/if}
          </td>
        {/each}
      </tr>
      {#if expandable && isExpanded}
        <tr class="expand-row">
          <td colspan={columns.length + 1}>
            <slot name="expand" {row} />
          </td>
        </tr>
      {/if}
    {/each}
  </tbody>
</table>

<style>
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  
  th, td {
    padding: 10px 12px;
    text-align: left;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
  
  th {
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.35px;
    user-select: none;
    background: rgba(255, 255, 255, 0.02);
  }
  
  th.sortable {
    cursor: pointer;
    transition: background 0.15s ease;
  }
  
  th.sortable:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  
  th.num, td.num {
    text-align: right;
  }
  
  td.primary {
    color: var(--vscode-editor-foreground);
    font-weight: 500;
  }
  
  td.muted {
    color: var(--vscode-descriptionForeground);
    opacity: 0.8;
  }
  
  td.highlight {
    color: #4fc3f7;
    font-weight: 600;
  }
  
  td.zero {
    opacity: 0.5;
  }
  
  tbody tr {
    transition: background 0.15s ease;
  }
  
  tbody tr:hover {
    background: rgba(255, 255, 255, 0.03);
  }
  
  .sort-indicator {
    margin-left: 4px;
    font-size: 10px;
    color: #4fc3f7;
  }
  
  .expand-col {
    width: 30px;
    padding: 4px;
  }
  
  .expand-button {
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    font-size: 10px;
    padding: 4px 8px;
    border-radius: 4px;
    transition: all 0.15s ease;
  }
  
  .expand-button:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--vscode-editor-foreground);
  }
  
  tr.expanded {
    background: rgba(79, 195, 247, 0.08);
  }
  
  .expand-row td {
    padding: 16px 20px;
    background: rgba(0, 0, 0, 0.15);
    border-bottom: 2px solid rgba(79, 195, 247, 0.2);
  }
  
  .pct-cell {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: flex-end;
  }
  
  .pct-bar {
    height: 4px;
    background: linear-gradient(90deg, #81c784, #4fc3f7);
    border-radius: 2px;
    min-width: 2px;
    max-width: 60px;
    transition: width 0.3s ease;
  }
  
  .pct-value {
    min-width: 40px;
    text-align: right;
  }
</style>
