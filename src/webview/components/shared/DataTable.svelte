<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  
  export let columns: Array<{ key: string; label: string; type?: 'string' | 'number' }>;
  export let rows: Record<string, unknown>[];
  export let sortable = true;
  
  const dispatch = createEventDispatcher();
  
  let sortKey = '';
  let sortDir: 'asc' | 'desc' = 'desc';
  
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
      <tr>
        {#each columns as col}
          <td class:num={col.type === 'number'}>
            {row[col.key]}
          </td>
        {/each}
      </tr>
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
</style>
