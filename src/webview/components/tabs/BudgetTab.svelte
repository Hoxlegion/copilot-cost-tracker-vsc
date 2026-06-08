<script lang="ts">
  import { dashboardData } from '../../stores/dashboard';
  import { filterState } from '../../stores/filter';
  import StatCard from '../shared/StatCard.svelte';
  import BudgetBar from '../shared/BudgetBar.svelte';
  import DataTable from '../shared/DataTable.svelte';
  
  $: data = $dashboardData;
  $: budgetCredits = data?.budgetCredits ?? 180;
  $: billingPeriodStartMs = data?.billingPeriodStartMs ?? 0;
  $: billingPeriodEndMs = data?.billingPeriodEndMs ?? 0;
  $: allSessions = data?.allSessions ?? [];
  
  $: filteredSessions = allSessions.filter(s => {
    if ($filterState.fromMs !== null && s.startTimestamp < $filterState.fromMs) return false;
    if ($filterState.toMs !== null && s.startTimestamp > $filterState.toMs) return false;
    return true;
  });
  
  $: filteredPeriodCredits = filteredSessions.reduce((sum, s) => sum + s.totalCredits, 0);
  $: filteredPeriodAggregate = (() => {
    const costUsd = filteredSessions.reduce((sum, s) => sum + s.totalCostUsd, 0);
    const credits = filteredSessions.reduce((sum, s) => sum + s.totalCredits, 0);
    const turns = filteredSessions.reduce((sum, s) => sum + s.turnCount, 0);
    return { costUsd, credits, turns };
  })();
  
  $: filteredModelBreakdown = (() => {
    const modelMap = new Map<string, {
      model: string;
      totalCostUsd: number;
      totalCredits: number;
      turnCount: number;
    }>();
    
    filteredSessions.forEach(s => {
      const current = modelMap.get(s.primaryModel) ?? {
        model: s.primaryModel,
        totalCostUsd: 0,
        totalCredits: 0,
        turnCount: 0,
      };
      current.totalCostUsd += s.totalCostUsd;
      current.totalCredits += s.totalCredits;
      current.turnCount += s.turnCount;
      modelMap.set(s.primaryModel, current);
    });
    
    const models = Array.from(modelMap.values());
    const totalCost = models.reduce((sum, m) => sum + m.totalCostUsd, 0);
    
    return models.map(m => ({
      ...m,
      percentage: totalCost > 0 ? (m.totalCostUsd / totalCost) * 100 : 0,
    })).sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  })();
  
  $: usagePct = budgetCredits > 0 ? ((filteredPeriodCredits / budgetCredits) * 100) : 0;
  $: usageColor = usagePct >= 100 ? '#e57373' : usagePct >= 80 ? '#ffb74d' : '#81c784';
  
  $: daysRemaining = Math.max(0, Math.ceil((billingPeriodEndMs - Date.now()) / (24 * 60 * 60 * 1000)));
  $: dailyBudgetRemaining = daysRemaining > 0 
    ? ((budgetCredits - filteredPeriodCredits) / daysRemaining).toFixed(1) 
    : '0';
  
  $: msInDay = 24 * 60 * 60 * 1000;
  $: totalDaysInPeriod = Math.max(1, Math.ceil((billingPeriodEndMs - billingPeriodStartMs) / msInDay));
  $: daysSincePeriodStart = Math.max(1, Math.ceil((Date.now() - billingPeriodStartMs) / msInDay));
  $: burnRate = daysSincePeriodStart > 0 ? filteredPeriodCredits / daysSincePeriodStart : 0;
  $: projectedPeriodCredits = burnRate * totalDaysInPeriod;
  $: forecastVisible = filteredPeriodAggregate.turns >= 50 || filteredPeriodCredits >= 0.5;
  $: forecastOverage = projectedPeriodCredits - budgetCredits;
  
  $: tokenDensity = (() => {
    const totalTokens = filteredPeriodAggregate.costUsd > 0 
      ? (filteredPeriodAggregate.costUsd * 1000000)
      : 0;
    return filteredPeriodCredits > 0 ? (totalTokens / filteredPeriodCredits) : 0;
  })();
  
  const modelColumns = [
    { key: 'model', label: 'Model', type: 'string' as const },
    { key: 'turnCount', label: 'Turns', type: 'number' as const },
    { key: 'totalCredits', label: 'Credits', type: 'number' as const },
    { key: 'percentage', label: '%', type: 'number' as const },
  ];
  
  $: modelRows = filteredModelBreakdown.map(m => ({
    model: m.model,
    turnCount: m.turnCount,
    totalCredits: m.totalCredits.toFixed(1),
    percentage: m.percentage.toFixed(1) + '%',
  }));
</script>

<div class="budget-tab">
  <div class="stat-row">
    <StatCard 
      label="Range Used"
      value="{usagePct.toFixed(1)}%"
      sub="{filteredPeriodCredits.toFixed(0)} / {budgetCredits} cr"
      valueColor={usageColor}
    >
      <BudgetBar percentage={usagePct} color={usageColor} />
    </StatCard>
    
    <StatCard 
      label="Days Remaining"
      value={daysRemaining}
      sub="~{dailyBudgetRemaining} cr/day budget"
    />
    
    <StatCard 
      label="Remaining Credits"
      value={Math.max(0, budgetCredits - filteredPeriodCredits).toFixed(0)}
      sub="of {budgetCredits} total"
    />
    
    <StatCard label="Forecast (Period End)">
      {#if forecastVisible}
        <div class="stat-value">{projectedPeriodCredits.toFixed(1)} cr</div>
        <div class="stat-sub">Burn rate: {burnRate.toFixed(2)} cr/day</div>
        {#if forecastOverage > 0}
          <div class="stat-sub" style="color: var(--vscode-errorForeground)">
            +{forecastOverage.toFixed(1)} cr over budget
          </div>
        {:else}
          <div class="stat-sub">
            {Math.abs(forecastOverage).toFixed(1)} cr under budget
          </div>
        {/if}
      {:else}
        <div class="stat-value">-</div>
        <div class="stat-sub">Forecast available once more usage data is collected</div>
        <div class="stat-sub">(>= 50 turns or >= 0.50 credits)</div>
      {/if}
    </StatCard>
    
    <StatCard 
      label="Token Density (Range)"
      value={tokenDensity > 0 ? Math.round(tokenDensity).toLocaleString() : '0'}
      sub={filteredPeriodCredits > 0 ? 'tokens per credit in range' : 'no credits in range'}
    />
  </div>
  
  <h3 class="section-title">Model Breakdown (Current Range)</h3>
  <DataTable columns={modelColumns} rows={modelRows} />
</div>

<style>
  .budget-tab {
    padding: 0;
  }
  
  .stat-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }
  
  .section-title {
    margin: 12px 0 8px;
    font-size: 12px;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
</style>
