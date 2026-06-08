<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  
  export let columns: Array<{ key: string; label: string; type?: 'string' | 'number' }>;
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
    const isNumber = col?.type === 'number';
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
</script>

<table>
  <thead>
    <tr>
      {#if expandable}
        <th class="expand-col"></th>
      {/if}
      {#each columns as col}
        <th 
          class:sortable={sortable}
          class:num={col.type === 'number'}
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
    {#each sortedRows as row}
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
        {#each columns as col}
          <td class:num={col.type === 'number'}>
            {row[col.key]}
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
    padding: 8px;
    text-align: left;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  
  th {
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    user-select: none;
  }
  
  th.sortable {
    cursor: pointer;
  }
  
  th.sortable:hover {
    background: var(--vscode-list-hoverBackground);
  }
  
  th.num, td.num {
    text-align: right;
  }
  
  .sort-indicator {
    margin-left: 4px;
    font-size: 10px;
  }
  
  .expand-col {
    width: 30px;
    padding: 4px;
  }
  
  .expand-button {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 2px;
  }
  
  .expand-button:hover {
    background: var(--vscode-list-hoverBackground);
  }
  
  tr.expanded {
    background: var(--vscode-list-activeSelectionBackground);
  }
  
  .expand-row td {
    padding: 12px 16px;
    background: var(--vscode-editor-background);
    border-bottom: 2px solid var(--vscode-panel-border);
  }
</style>
