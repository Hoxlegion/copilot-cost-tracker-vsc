<script lang="ts">
  import { dashboardData, formatUsd } from './stores/dashboard';
  import GlobalFilter from './components/shared/GlobalFilter.svelte';
  import DashboardTab from './components/tabs/DashboardTab.svelte';
  import ActivityTab from './components/tabs/ActivityTab.svelte';
  import ModelsTabV2 from './components/tabs/ModelsTabV2.svelte';
  import EfficiencyTab from './components/tabs/EfficiencyTab.svelte';
  import BudgetTab from './components/tabs/BudgetTab.svelte';
  import { BarChart3, Activity, Bot, Zap, Wallet } from '@lucide/svelte';
  
  let activeTab = 'dashboard';
  
  $: data = $dashboardData;
  
  // Header stats
  $: allSessions = data?.allSessions ?? [];
  $: todayStart = (() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  })();
  $: todayCost = allSessions
    .filter(s => s.startTimestamp >= todayStart)
    .reduce((sum, s) => sum + s.totalCostUsd, 0);
  $: periodCost = data?.periodAggregate?.costUsd ?? 0;
  $: budgetCredits = data?.budgetCredits ?? 0;
  $: periodCredits = data?.periodCredits ?? 0;
  $: budgetPct = budgetCredits > 0 ? ((periodCredits / budgetCredits) * 100) : 0;
</script>

<div class="dashboard">
  <header class="header">
    <h1>Copilot Cost Tracker</h1>
    <div class="stats">
      {#if data}
        <span class="stat-chip today">{$formatUsd(todayCost)} <span class="stat-dim">today</span></span>
        <span class="stat-chip period">{$formatUsd(periodCost)} <span class="stat-dim">period</span></span>
        {#if budgetCredits > 0}
          <span class="stat-chip budget" class:warn={budgetPct >= 80} class:over={budgetPct >= 100}>
            Budget {budgetPct.toFixed(0)}%
          </span>
        {/if}
      {/if}
    </div>
  </header>
  
  <nav class="tabs">
    <button class:active={activeTab === 'dashboard'} on:click={() => activeTab = 'dashboard'} data-tab="dashboard">
      <BarChart3 size={16} />
      <span class="tab-label">Dashboard</span>
    </button>
    <button class:active={activeTab === 'activity'} on:click={() => activeTab = 'activity'} data-tab="activity">
      <Activity size={16} />
      <span class="tab-label">Activity</span>
    </button>
    <button class:active={activeTab === 'models'} on:click={() => activeTab = 'models'} data-tab="models">
      <Bot size={16} />
      <span class="tab-label">Models</span>
    </button>
    <button class:active={activeTab === 'efficiency'} on:click={() => activeTab = 'efficiency'} data-tab="efficiency">
      <Zap size={16} />
      <span class="tab-label">Efficiency</span>
    </button>
    <button class:active={activeTab === 'budget'} on:click={() => activeTab = 'budget'} data-tab="budget">
      <Wallet size={16} />
      <span class="tab-label">Budget</span>
    </button>
  </nav>
  
  {#if data}
    <GlobalFilter />
  {/if}
  
  <main class="tab-content">
    {#if !data}
      <div class="loading">
        <div class="loading-icon">◐</div>
        <div class="loading-title">Crunching your Copilot usage…</div>
        <div class="loading-sub">Reading local telemetry — no data leaves your machine.</div>
      </div>
    {:else if activeTab === 'dashboard'}
      <DashboardTab />
    {:else if activeTab === 'activity'}
      <ActivityTab />
    {:else if activeTab === 'models'}
      <ModelsTabV2 />
    {:else if activeTab === 'efficiency'}
      <EfficiencyTab />
    {:else if activeTab === 'budget'}
      <BudgetTab />
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
    /* Tabular figures keep columns of credits/USD aligned (inherited by children). */
    font-variant-numeric: tabular-nums;
    /* Brand palette — single source of truth, mirrors utils/palette.ts. */
    --cct-accent: #4fc3f7;
    --cct-success: #81c784;
    --cct-warning: #ffb74d;
    --cct-danger: #e57373;
    --cct-purple: #ba68c8;
  }
  
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    border-bottom: 2px solid var(--vscode-panel-border);
    background: linear-gradient(to right, var(--vscode-editor-background), var(--vscode-editorWidget-background));
  }
  
  .header h1 {
    font-size: 15px;
    font-weight: 700;
    margin: 0;
    background: linear-gradient(135deg, #4fc3f7, #81c784);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  
  .stats {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  
  .stat-chip {
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-editor-foreground);
    padding: 3px 10px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--vscode-editorWidget-background) 80%, #103449 20%);
    border: 1px solid var(--vscode-panel-border);
  }
  
  .stat-dim {
    font-weight: 400;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .stat-chip.budget {
    color: #81c784;
    border-color: rgba(129, 199, 132, 0.3);
  }
  
  .stat-chip.budget.warn {
    color: #ffb74d;
    border-color: rgba(255, 183, 77, 0.3);
  }
  
  .stat-chip.budget.over {
    color: #e57373;
    border-color: rgba(229, 115, 115, 0.3);
  }
  
  .tabs {
    display: flex;
    border-bottom: 2px solid var(--vscode-panel-border);
    padding: 0 16px;
    background: var(--vscode-editor-background);
    gap: 2px;
  }
  
  .tabs button {
    padding: 10px 18px;
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
  
  .tabs button[data-tab="dashboard"].active { border-bottom-color: #4fc3f7; }
  .tabs button[data-tab="activity"].active { border-bottom-color: #ba68c8; }
  .tabs button[data-tab="models"].active { border-bottom-color: #ffb74d; }
  .tabs button[data-tab="efficiency"].active { border-bottom-color: #81c784; }
  .tabs button[data-tab="budget"].active { border-bottom-color: #e57373; }
  
  .tabs button :global(svg) {
    width: 16px;
    height: 16px;
    opacity: 0.7;
  }
  
  .tabs button.active :global(svg) {
    opacity: 1;
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
    padding: 48px 20px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
  }

  .loading-icon {
    font-size: 28px;
    color: var(--cct-accent);
    animation: cct-spin 1.4s linear infinite;
    display: inline-block;
  }

  .loading-title {
    margin-top: 12px;
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-editor-foreground);
  }

  .loading-sub {
    margin-top: 4px;
    font-size: 12px;
  }

  @keyframes cct-spin {
    to { transform: rotate(360deg); }
  }
</style>
