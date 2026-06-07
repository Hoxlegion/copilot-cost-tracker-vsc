<script lang="ts">
  import { dashboardData } from './stores/dashboard';
  import GlobalFilter from './components/shared/GlobalFilter.svelte';
  import OverviewTab from './components/tabs/OverviewTab.svelte';
  import BudgetTab from './components/tabs/BudgetTab.svelte';
  import SessionsTab from './components/tabs/SessionsTab.svelte';
  import ModelsTab from './components/tabs/ModelsTab.svelte';
  import TokensTab from './components/tabs/TokensTab.svelte';
  import InsightsTab from './components/tabs/InsightsTab.svelte';
  import EstimatesTab from './components/tabs/EstimatesTab.svelte';
  
  let activeTab = 'overview';
  
  $: data = $dashboardData;
</script>

<div class="dashboard">
  <header class="header">
    <h1>Copilot Cost Tracker</h1>
    <div class="stats">
      {#if data}
        <span>Today: <span class="val">${data.monthTotal.costUsd.toFixed(2)}</span></span>
        <span>Budget: <span class="val">{data.budgetCredits > 0 ? ((data.periodCredits / data.budgetCredits) * 100).toFixed(1) : '0'}%</span></span>
      {/if}
    </div>
  </header>
  
  <nav class="tabs">
    <button class:active={activeTab === 'overview'} on:click={() => activeTab = 'overview'}>Overview</button>
    <button class:active={activeTab === 'budget'} on:click={() => activeTab = 'budget'}>Spending</button>
    <button class:active={activeTab === 'sessions'} on:click={() => activeTab = 'sessions'}>Sessions</button>
    <button class:active={activeTab === 'models'} on:click={() => activeTab = 'models'}>Models</button>
    <button class:active={activeTab === 'tokens'} on:click={() => activeTab = 'tokens'}>Tokens</button>
    <button class:active={activeTab === 'insights'} on:click={() => activeTab = 'insights'}>Insights</button>
    <button class:active={activeTab === 'estimates'} on:click={() => activeTab = 'estimates'}>Estimates ⚠</button>
  </nav>
  
  {#if data}
    <GlobalFilter />
  {/if}
  
  <main class="tab-content">
    {#if !data}
      <div class="loading">Loading dashboard data...</div>
    {:else if activeTab === 'overview'}
      <OverviewTab />
    {:else if activeTab === 'budget'}
      <BudgetTab />
    {:else if activeTab === 'sessions'}
      <SessionsTab />
    {:else if activeTab === 'models'}
      <ModelsTab />
    {:else if activeTab === 'tokens'}
      <TokensTab />
    {:else if activeTab === 'insights'}
      <InsightsTab />
    {:else if activeTab === 'estimates'}
      <EstimatesTab />
    {/if}
  </main>
</div>

<style>
  .dashboard {
    font-family: var(--vscode-font-family);
    font-size: 13px;
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  
  .header h1 {
    font-size: 14px;
    font-weight: 600;
  }
  
  .stats {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  
  .stats .val {
    font-weight: 600;
    color: var(--vscode-editor-foreground);
  }
  
  .tabs {
    display: flex;
    border-bottom: 1px solid var(--vscode-panel-border);
    padding: 0 16px;
  }
  
  .tabs button {
    padding: 8px 14px;
    cursor: pointer;
    border: none;
    border-bottom: 2px solid transparent;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    background: none;
    transition: all 0.15s;
  }
  
  .tabs button:hover {
    color: var(--vscode-editor-foreground);
  }
  
  .tabs button.active {
    color: var(--vscode-editor-foreground);
    border-bottom-color: var(--vscode-progressBar-background);
    font-weight: 600;
  }
  
  .tab-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }
  
  .loading {
    padding: 20px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
  }
</style>
