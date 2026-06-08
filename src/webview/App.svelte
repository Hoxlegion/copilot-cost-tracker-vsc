<script lang="ts">
  import { dashboardData } from './stores/dashboard';
  import GlobalFilter from './components/shared/GlobalFilter.svelte';
  import OverviewTab from './components/tabs/OverviewTab.svelte';
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
    <button class:active={activeTab === 'overview'} on:click={() => activeTab = 'overview'} data-tab="overview">
      <span class="tab-icon">📊</span>
      <span class="tab-label">Overview</span>
    </button>
    <button class:active={activeTab === 'sessions'} on:click={() => activeTab = 'sessions'} data-tab="sessions">
      <span class="tab-icon">💬</span>
      <span class="tab-label">Sessions</span>
    </button>
    <button class:active={activeTab === 'models'} on:click={() => activeTab = 'models'} data-tab="models">
      <span class="tab-icon">🤖</span>
      <span class="tab-label">Models</span>
    </button>
    <button class:active={activeTab === 'tokens'} on:click={() => activeTab = 'tokens'} data-tab="tokens">
      <span class="tab-icon">🔤</span>
      <span class="tab-label">Tokens</span>
    </button>
    <button class:active={activeTab === 'insights'} on:click={() => activeTab = 'insights'} data-tab="insights">
      <span class="tab-icon">💡</span>
      <span class="tab-label">Insights</span>
    </button>
    <button class:active={activeTab === 'estimates'} on:click={() => activeTab = 'estimates'} data-tab="estimates">
      <span class="tab-icon">⚠️</span>
      <span class="tab-label">Estimates</span>
    </button>
  </nav>
  
  {#if data}
    <GlobalFilter />
  {/if}
  
  <main class="tab-content">
    {#if !data}
      <div class="loading">Loading dashboard data...</div>
    {:else if activeTab === 'overview'}
      <OverviewTab />
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
    padding: 12px 16px;
    border-bottom: 2px solid var(--vscode-panel-border);
    background: linear-gradient(to right, var(--vscode-editor-background), var(--vscode-editorWidget-background));
  }
  
  .header h1 {
    font-size: 16px;
    font-weight: 700;
    margin: 0;
    background: linear-gradient(135deg, #4fc3f7, #81c784);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  
  .stats {
    display: flex;
    gap: 20px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  
  .stats span {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  
  .stats .val {
    font-weight: 700;
    color: var(--vscode-editor-foreground);
    font-size: 13px;
  }
  
  .tabs {
    display: flex;
    border-bottom: 2px solid var(--vscode-panel-border);
    padding: 0 16px;
    background: var(--vscode-editor-background);
    gap: 4px;
  }
  
  .tabs button {
    padding: 10px 16px;
    cursor: pointer;
    border: none;
    border-bottom: 3px solid transparent;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    background: none;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    gap: 6px;
    position: relative;
  }
  
  .tabs button:hover {
    color: var(--vscode-editor-foreground);
    background: var(--vscode-list-hoverBackground);
    border-radius: 4px 4px 0 0;
  }
  
  .tabs button.active {
    color: var(--vscode-editor-foreground);
    font-weight: 600;
    background: var(--vscode-editor-background);
  }
  
  .tabs button[data-tab="overview"].active {
    border-bottom-color: #4fc3f7;
  }
  
  .tabs button[data-tab="sessions"].active {
    border-bottom-color: #ba68c8;
  }
  
  .tabs button[data-tab="models"].active {
    border-bottom-color: #ffb74d;
  }
  
  .tabs button[data-tab="tokens"].active {
    border-bottom-color: #4db6ac;
  }
  
  .tabs button[data-tab="insights"].active {
    border-bottom-color: #fff176;
  }
  
  .tabs button[data-tab="estimates"].active {
    border-bottom-color: #e57373;
  }
  
  .tab-icon {
    font-size: 14px;
    line-height: 1;
  }
  
  .tab-label {
    font-size: 12px;
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
