import type { DashboardViewData } from "./index";

export function renderDashboardScript(v: DashboardViewData): string {
  return `
  <script nonce="${v.nonce}">
    const AGENT_LABEL_MAP = ${v.agentLabelMapJson};

    function normalizeAgentName(agentName) {
      if (!agentName || agentName === 'unknown') return 'Unknown';
      return AGENT_LABEL_MAP[agentName] || agentName;
    }

    function switchToTab(tabName) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      const tab = document.querySelector('.tab[data-tab="' + tabName + '"]');
      if (tab) tab.classList.add('active');
      const content = document.getElementById('tab-' + tabName);
      if (content) content.classList.add('active');
    }

    function switchSessionPane(paneName) {
      document.querySelectorAll('.session-subtab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sessionsPane === paneName);
      });
      document.querySelectorAll('.session-pane').forEach(p => p.classList.remove('active'));
      const pane = document.getElementById('sessions-pane-' + paneName);
      if (pane) pane.classList.add('active');
    }

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => { switchToTab(tab.dataset.tab); });
    });

    document.querySelectorAll('.session-subtab').forEach(btn => {
      btn.addEventListener('click', () => { switchSessionPane(btn.dataset.sessionsPane || 'summary'); });
    });

    const helpButton = document.getElementById('helpButton');
    const helpModal = document.getElementById('helpModal');
    const closeHelpButton = document.getElementById('closeHelpButton');
    const modalOverlay = helpModal.querySelector('.modal-overlay');

    if (helpButton) helpButton.addEventListener('click', () => helpModal.classList.add('show'));
    if (closeHelpButton) closeHelpButton.addEventListener('click', () => helpModal.classList.remove('show'));
    if (modalOverlay) modalOverlay.addEventListener('click', () => helpModal.classList.remove('show'));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && helpModal.classList.contains('show')) helpModal.classList.remove('show');
    });

    const textColor = getComputedStyle(document.body).getPropertyValue('color') || '#ccc';
    const gridColor = 'rgba(128,128,128,0.15)';
    const budgetCredits = ${v.budgetCredits};
    const billingPeriodStartMs = ${v.billingPeriodStartMs};

    function appendCell(tr, value, className, title) {
      const td = document.createElement('td');
      if (className) td.className = className;
      td.textContent = String(value ?? '');
      if (title) td.title = String(title);
      tr.appendChild(td);
    }

    const dailyRangeSeries = ${v.dailyRangeSeriesJson};

    const dailyChartInst = new Chart(document.getElementById('dailyChart'), {
      type: 'line',
      data: {
        labels: ${v.dailyLabels},
        datasets: [{
          label: 'Cost (USD)', data: ${v.dailyData}, borderColor: '#4fc3f7',
          backgroundColor: 'rgba(79,195,247,0.08)', fill: true, tension: 0.3, pointRadius: 2,
        }, {
          label: 'Credits', data: ${v.dailyCreditsData}, borderColor: '#81c784',
          fill: false, tension: 0.3, pointRadius: 2, yAxisID: 'y2',
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { color: textColor, maxTicksLimit: 8, font: { size: 10 } }, grid: { color: gridColor } },
          y: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor }, title: { display: true, text: 'USD', color: textColor, font: { size: 10 } } },
          y2: { position: 'right', ticks: { color: textColor, font: { size: 10 } }, grid: { display: false }, title: { display: true, text: 'Credits', color: textColor, font: { size: 10 } } }
        },
        plugins: { legend: { labels: { color: textColor, font: { size: 11 } } } }
      }
    });

    const modelDataByPeriod = ${v.modelDataByPeriodJson};
    const colors = ['#4fc3f7','#81c784','#ffb74d','#e57373','#ba68c8','#4db6ac','#fff176','#90a4ae'];
    const modelLabels = ${v.modelLabels};
    const modelCostData = ${v.modelCostData};
    const modelTurnData = ${v.modelTurnData};
    const modelPctData = ${v.modelPctData};
    const agentBreakdown30d = ${v.agentBreakdownData};
    const agentDailyBreakdown = ${v.dailyAgentBreakdownData};

    const modelBarChartInst = new Chart(document.getElementById('modelBarChart'), {
      type: 'bar',
      data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        scales: {
          x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
          y: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } }
        },
        plugins: { legend: { display: false } }
      }
    });

    const modelPieChartInst = new Chart(document.getElementById('modelPieChart'), {
      type: 'doughnut',
      data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: textColor, font: { size: 10 } }, position: 'right' } }
      }
    });

    const sessions = ${v.sessionsJson};
    const turnDiscovery = ${v.turnDiscoveryJson};
    const MAX_SESSION_ROWS = 500;
    const globalFilter = { preset: 'period', fromMs: null, toMs: null };
    const sessionsSort = { key: 'ts', dir: 'desc' };
    const modelsSort = { key: 'cost', dir: 'desc' };
    const tokensSort = { key: 'totalCost', dir: 'desc' };
    const discoverySort = { key: 'lastTimeMs', dir: 'desc' };
    const discoveryState = { onlyTools: false, onlyAnomalies: false, expandAll: false, expandedKeys: new Set() };
    let overviewChartMode = 'cost';

    function getDiscoveryKey(row) { return String(row.chatSessionId || '') + '::' + String(Number(row.turnIndex || 0)); }
    function isDiscoveryAnomaly(row) { return Number(row.cacheHitPct || 0) < 40 || Number(row.toolCalls || 0) > 0; }

    function formatLocalDateTimeInput(ts) {
      const d = new Date(ts);
      const pad = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function formatSessionDate(ts) {
      return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function getPresetRange(preset) {
      const now = Date.now();
      const msDay = 24 * 60 * 60 * 1000;
      if (preset === 'today') { const d = new Date(); const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); return { fromMs: start, toMs: now }; }
      if (preset === '30d') return { fromMs: now - 30 * msDay, toMs: now };
      if (preset === 'period') return { fromMs: billingPeriodStartMs, toMs: now };
      return { fromMs: now - 7 * msDay, toMs: now };
    }

    function applyPreset(preset) {
      const range = getPresetRange(preset);
      globalFilter.preset = preset;
      globalFilter.fromMs = range.fromMs;
      globalFilter.toMs = range.toMs;
      document.getElementById('globalFrom').value = formatLocalDateTimeInput(range.fromMs);
      document.getElementById('globalTo').value = formatLocalDateTimeInput(range.toMs);
      document.querySelectorAll('.global-filter-bar .preset').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === preset);
      });
      rerenderAll();
    }

    function getRangeSummary(fromMs, toMs) {
      return (fromMs ? formatSessionDate(fromMs) : 'any') + ' → ' + (toMs ? formatSessionDate(toMs) : 'now');
    }

    function getFilteredSessionsBase() {
      return sessions.filter(s =>
        (globalFilter.fromMs === null || s.ts >= globalFilter.fromMs) &&
        (globalFilter.toMs === null || s.ts <= globalFilter.toMs)
      );
    }

    function getFilteredDailySeries() {
      return dailyRangeSeries.filter(d => {
        const dayTs = new Date(d.period + 'T00:00:00').getTime();
        const dayEndTs = dayTs + 86400000 - 1;
        return (globalFilter.fromMs === null || dayEndTs >= globalFilter.fromMs)
          && (globalFilter.toMs === null || dayTs <= globalFilter.toMs);
      });
    }

    function compareValues(a, b, dir) {
      if (typeof a === 'string' || typeof b === 'string') { const cmp = String(a).localeCompare(String(b)); return dir === 'asc' ? cmp : -cmp; }
      const diff = Number(a) - Number(b);
      return dir === 'asc' ? diff : -diff;
    }

    function getTextFilter(id) { const el = document.getElementById(id); return (el && el.value ? el.value.trim().toLowerCase() : ''); }
    function includesFilter(value, filter) { return !filter || String(value).toLowerCase().includes(filter); }

    function getModelRowsFromSessions(baseSessions) {
      const grouped = new Map();
      for (const s of baseSessions) {
        const item = grouped.get(s.model) || { model: s.model, turns: 0, cost: 0, credits: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, latencies: [] };
        item.turns += Number(s.turns || 0);
        item.cost += Number(s.costUsd || 0);
        item.credits += Number(s.credits || 0);
        item.inputTokens += Number(s.inputTokens || 0);
        item.outputTokens += Number(s.outputTokens || 0);
        item.cachedTokens += Number(s.cachedTokens || 0);
        item.totalTokens += Number(s.totalTokens || 0);
        if (Number(s.avgLatencyMs) > 0) item.latencies.push(Number(s.avgLatencyMs));
        grouped.set(s.model, item);
      }
      const rows = Array.from(grouped.values());
      const totalCost = rows.reduce((sum, r) => sum + r.cost, 0);
      return rows.map(r => {
        const sorted = r.latencies.slice().sort((a, b) => a - b);
        const avgMs = sorted.length > 0 ? Math.round(sorted.reduce((sum, n) => sum + n, 0) / sorted.length) : 0;
        const tailMs = sorted.length > 0 ? sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)] : 0;
        return {
          model: r.model, turns: r.turns, cost: r.cost, credits: r.credits,
          pct: totalCost > 0 ? (r.cost / totalCost) * 100 : 0,
          inputTokens: r.inputTokens, outputTokens: r.outputTokens, cachedTokens: r.cachedTokens, totalTokens: r.totalTokens,
          cachePct: (r.inputTokens + r.cachedTokens) > 0 ? (r.cachedTokens / (r.inputTokens + r.cachedTokens)) * 100 : 0,
          avgMs, tailMs,
          tailLabel: sorted.length >= 20 ? 'P90' : sorted.length >= 5 ? 'P50' : '-',
        };
      });
    }

    function getRangePresetLabel() {
      if (globalFilter.preset === 'today') return 'Today';
      if (globalFilter.preset === '30d') return 'Last 30 days';
      if (globalFilter.preset === 'period') return 'This period';
      if (globalFilter.preset === '7d') return 'Last 7 days';
      return 'Custom range';
    }

    function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

    function formatCompactNumber(value) {
      if (!Number.isFinite(value)) return '0';
      if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(1) + 'M';
      if (Math.abs(value) >= 1000) return (value / 1000).toFixed(1) + 'K';
      return String(Math.round(value));
    }

    function roundHalfUp(value, decimals) {
      const factor = Math.pow(10, decimals);
      return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
    }

    function updateOverviewAndBudget(baseSessions, modelRows, dailySeries, insightDays) {
      const totalCost = baseSessions.reduce((sum, s) => sum + Number(s.costUsd || 0), 0);
      const totalCredits = baseSessions.reduce((sum, s) => sum + Number(s.credits || 0), 0);
      const totalTurns = baseSessions.reduce((sum, s) => sum + Number(s.turns || 0), 0);
      const totalInput = insightDays.reduce((sum, d) => sum + d.input, 0);
      const totalCached = insightDays.reduce((sum, d) => sum + d.cached, 0);
      const totalOutput = insightDays.reduce((sum, d) => sum + d.output, 0);
      const billableInput = totalInput + totalCached;
      const cacheHitPct = billableInput > 0 ? (totalCached / billableInput) * 100 : 0;
      const totalTokens = billableInput + totalOutput;
      const usagePct = budgetCredits > 0 ? ((totalCredits / budgetCredits) * 100) : 0;
      const usageColor = usagePct >= 100 ? '#e57373' : usagePct >= 80 ? '#ffb74d' : '#81c784';
      const presetLabel = getRangePresetLabel();

      setText('overviewRangeCostLabel', 'Range Cost (' + presetLabel + ')');
      setText('overviewRangeCost', '$' + totalCost.toFixed(2));
      setText('overviewRangeCostSub', totalCredits.toFixed(0) + ' cr · ' + totalTurns + ' turns');
      setText('overviewRangeCredits', totalCredits.toFixed(0) + ' cr');
      setText('overviewRangeCreditsSub', '$' + totalCost.toFixed(2) + ' · ' + totalTurns + ' turns');
      setText('overviewRangeTurns', String(totalTurns));
      setText('overviewRangeTurnsSub', '$' + totalCost.toFixed(2) + ' · ' + totalCredits.toFixed(0) + ' cr');
      setText('overviewSessionCount', String(baseSessions.length));
      setText('overviewSessionCountSub', 'current range');
      setText('overviewCallCount', String(totalTurns));
      setText('overviewCallCountSub', 'turns in range');
      setText('headerTokenIn', formatCompactNumber(billableInput));
      setText('headerTokenOut', formatCompactNumber(totalOutput));
      setText('headerTokenCache', cacheHitPct.toFixed(1) + '%');

      setText('budgetUsedLabel', 'Range Used');
      setText('budgetUsageValue', usagePct.toFixed(1) + '%');
      setText('budgetUsageSub', totalCredits.toFixed(0) + ' / ' + budgetCredits + ' cr');
      setText('budgetRemainingValue', Math.max(0, budgetCredits - totalCredits).toFixed(0));
      setText('budgetRemainingSub', 'of ' + budgetCredits + ' total');
      const tokenDensity = totalCredits > 0 ? (totalTokens / totalCredits) : 0;
      setText('budgetTokenDensity', formatCompactNumber(tokenDensity));
      setText('budgetTokenDensitySub', totalCredits > 0 ? 'tokens per credit in range' : 'no credits in range');
      const fill = document.getElementById('budgetUsageFill');
      if (fill) { fill.style.width = Math.min(100, usagePct).toFixed(1) + '%'; fill.style.background = usageColor; }

      const ordered = dailySeries.slice().sort((a, b) => String(a.period).localeCompare(String(b.period)));
      const labels = ordered.map(d => d.period);
      const costs = ordered.map(d => d.cost);
      const credits = ordered.map(d => d.credits);
      const tokenOrdered = insightDays.slice().sort((a, b) => String(a.period).localeCompare(String(b.period)));
      if (overviewChartMode === 'tokens') {
        dailyChartInst.data.labels = tokenOrdered.map(d => d.period);
        dailyChartInst.data.datasets = [
          { label: 'Cached Input', data: tokenOrdered.map(d => d.cached), borderColor: '#4fc3f7', backgroundColor: 'rgba(79,195,247,0.20)', fill: false, tension: 0.3, pointRadius: 2 },
          { label: 'Net Input', data: tokenOrdered.map(d => d.input), borderColor: '#81c784', backgroundColor: 'rgba(129,199,132,0.20)', fill: false, tension: 0.3, pointRadius: 2 },
          { label: 'Output', data: tokenOrdered.map(d => d.output), borderColor: '#ffb74d', backgroundColor: 'rgba(255,183,77,0.20)', fill: false, tension: 0.3, pointRadius: 2 },
        ];
      } else {
        dailyChartInst.data.labels = labels;
        dailyChartInst.data.datasets = [
          { label: 'Cost (USD)', data: costs, borderColor: '#4fc3f7', backgroundColor: 'rgba(79,195,247,0.08)', fill: true, tension: 0.3, pointRadius: 2 },
          { label: 'Credits', data: credits, borderColor: '#81c784', fill: false, tension: 0.3, pointRadius: 2, yAxisID: 'y2' },
        ];
      }
      dailyChartInst.update();
      setText('overviewChartTitle', (overviewChartMode === 'tokens' ? 'Tokens' : 'Cost & Credits') + ' — ' + presetLabel);
      setText('budgetModelTitle', 'Model Breakdown (' + presetLabel + ')');
    }

    function getFallbackModelRows() {
      return (modelDataByPeriod['7d'] || modelDataByPeriod['30d'] || []).map(r => ({ ...r, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, cachePct: 0 }));
    }

    function renderModels(rows) {
      const labels = rows.map(r => r.model);
      const costs = rows.map(r => r.cost);
      const pcts = rows.map(r => r.pct);
      const clrs = colors.slice(0, Math.max(labels.length, 1));
      modelBarChartInst.data.labels = labels;
      modelBarChartInst.data.datasets[0].data = costs;
      modelBarChartInst.data.datasets[0].backgroundColor = clrs;
      modelBarChartInst.update();
      modelPieChartInst.data.labels = labels;
      modelPieChartInst.data.datasets[0].data = pcts;
      modelPieChartInst.data.datasets[0].backgroundColor = clrs;
      modelPieChartInst.update();
      const body = document.getElementById('modelsBody');
      body.innerHTML = '';
      rows.forEach(r => {
        const tr = document.createElement('tr');
        appendCell(tr, r.model);
        appendCell(tr, r.turns, 'num');
        appendCell(tr, '$' + r.cost.toFixed(3), 'num');
        appendCell(tr, r.pct.toFixed(1) + '%', 'num');
        appendCell(tr, formatCompactNumber(r.totalTokens), 'num');
        appendCell(tr, r.cachePct.toFixed(1) + '%', 'num');
        appendCell(tr, r.avgMs > 0 ? r.avgMs : '-', 'num');
        appendCell(tr, r.tailMs > 0 ? r.tailLabel + ' ' + r.tailMs : '-', 'num');
        body.appendChild(tr);
      });
    }

    function getAgentRowsForRange() {
      const grouped = new Map();
      for (const row of agentDailyBreakdown) {
        const dayTs = new Date(row.period + 'T00:00:00').getTime();
        const dayEndTs = dayTs + 86400000 - 1;
        if ((globalFilter.fromMs !== null && dayEndTs < globalFilter.fromMs) || (globalFilter.toMs !== null && dayTs > globalFilter.toMs)) continue;
        const key = row.agentName || 'unknown';
        const item = grouped.get(key) || { agentName: key, totalCostUsd: 0, totalCredits: 0, turnCount: 0, percentage: 0 };
        item.totalCostUsd += Number(row.totalCostUsd || 0);
        item.totalCredits += Number(row.totalCredits || 0);
        item.turnCount += Number(row.turnCount || 0);
        grouped.set(key, item);
      }
      const rows = Array.from(grouped.values()).sort((a, b) => b.totalCostUsd - a.totalCostUsd).slice(0, 12);
      const totalCost = rows.reduce((sum, r) => sum + r.totalCostUsd, 0);
      rows.forEach(r => { r.percentage = totalCost > 0 ? (r.totalCostUsd / totalCost) * 100 : 0; });
      return rows;
    }

    function renderAgentsForRange() {
      const body = document.getElementById('modelsAgentsBody');
      body.innerHTML = '';
      const rangeRows = getAgentRowsForRange();
      const rows = rangeRows.length > 0 ? rangeRows : agentBreakdown30d;
      rows.forEach(row => {
        const tr = document.createElement('tr');
        appendCell(tr, normalizeAgentName(row.agentName), '', row.agentName || 'unknown');
        appendCell(tr, Number(row.turnCount || 0), 'num');
        appendCell(tr, Number(row.totalCredits || 0).toFixed(1), 'num');
        appendCell(tr, '$' + Number(row.totalCostUsd || 0).toFixed(3), 'num');
        appendCell(tr, Number(row.percentage || 0).toFixed(1) + '%', 'num');
        body.appendChild(tr);
      });
      setText('modelsAgentsTitle', 'Agents (' + getRangePresetLabel() + ', by Cost)');
    }

    const sessionsBody = document.getElementById('sessionsBody');
    const sessionCountEl = document.getElementById('sessionCount');

    function createSessionDetailContent(session) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'padding:10px 12px;background:var(--card-bg);border:1px solid var(--border);border-radius:4px';
      const title = document.createElement('div');
      title.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:0.3px;color:var(--muted);margin-bottom:8px';
      title.textContent = 'Per-model breakdown';
      wrapper.appendChild(title);
      const rows = Array.isArray(session.modelBreakdown) ? session.modelBreakdown : [];
      if (rows.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:12px;color:var(--muted)';
        empty.textContent = 'No per-model breakdown is available for this session.';
        wrapper.appendChild(empty);
        return wrapper;
      }
      const table = document.createElement('table');
      table.style.marginBottom = '0';
      const thead = document.createElement('thead');
      const headTr = document.createElement('tr');
      ['Model', 'Turns', 'Cost', 'Credits', 'Tokens', 'Cache%'].forEach((label, idx) => {
        const th = document.createElement('th');
        th.textContent = label;
        if (idx > 0) th.className = 'num';
        headTr.appendChild(th);
      });
      thead.appendChild(headTr);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      rows.forEach(row => {
        const tr = document.createElement('tr');
        appendCell(tr, row.model);
        appendCell(tr, Number(row.turnCount || 0), 'num');
        appendCell(tr, '$' + Number(row.totalCostUsd || 0).toFixed(3), 'num');
        appendCell(tr, Number(row.totalCredits || 0).toFixed(1), 'num');
        const modelTotalTokens = Number(row.totalInputTokens || 0) + Number(row.totalOutputTokens || 0) + Number(row.totalCachedTokens || 0);
        appendCell(tr, formatCompactNumber(modelTotalTokens), 'num');
        const modelInputPlusCached = Number(row.totalInputTokens || 0) + Number(row.totalCachedTokens || 0);
        const modelCachePct = modelInputPlusCached > 0 ? (Number(row.totalCachedTokens || 0) / modelInputPlusCached) * 100 : 0;
        appendCell(tr, modelCachePct.toFixed(1) + '%', 'num');
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrapper.appendChild(table);
      return wrapper;
    }

    function renderSessions(filteredBase) {
      const filtered = filteredBase.filter(s => {
        const cachePct = (Number(s.inputTokens || 0) + Number(s.cachedTokens || 0)) > 0 ? (Number(s.cachedTokens || 0) / (Number(s.inputTokens || 0) + Number(s.cachedTokens || 0))) * 100 : 0;
        return includesFilter(formatSessionDate(s.ts), getTextFilter('sessionsFilterDate'))
          && includesFilter(s.model, getTextFilter('sessionsFilterModel'))
          && includesFilter(s.turns, getTextFilter('sessionsFilterTurns'))
          && includesFilter(Number(s.costUsd).toFixed(3), getTextFilter('sessionsFilterCost'))
          && includesFilter(Number(s.credits).toFixed(1), getTextFilter('sessionsFilterCredits'))
          && includesFilter(Number(s.totalTokens || 0), getTextFilter('sessionsFilterTokens'))
          && includesFilter(cachePct.toFixed(1), getTextFilter('sessionsFilterCachePct'))
          && includesFilter(s.avgLatencyMs, getTextFilter('sessionsFilterLatency'));
      }).sort((a, b) => compareValues(a[sessionsSort.key], b[sessionsSort.key], sessionsSort.dir));

      const visible = filtered.slice(0, MAX_SESSION_ROWS);
      sessionsBody.innerHTML = '';
      visible.forEach(s => {
        const tr = document.createElement('tr');
        tr.dataset.sessionId = s.sessionId;
        const toggleTd = document.createElement('td');
        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.textContent = '▸';
        toggleButton.title = 'Show per-model details';
        toggleButton.style.cssText = 'width:20px;height:20px;border:1px solid var(--border);background:var(--card-bg);color:var(--fg);border-radius:3px;cursor:pointer';
        toggleTd.appendChild(toggleButton);
        tr.appendChild(toggleTd);
        appendCell(tr, formatSessionDate(s.ts));
        appendCell(tr, s.model);
        appendCell(tr, s.turns, 'num');
        appendCell(tr, '$' + Number(s.costUsd).toFixed(3), 'num');
        appendCell(tr, Number(s.credits).toFixed(1), 'num');
        appendCell(tr, formatCompactNumber(Number(s.totalTokens || 0)), 'num');
        const cachePct = (Number(s.inputTokens || 0) + Number(s.cachedTokens || 0)) > 0 ? (Number(s.cachedTokens || 0) / (Number(s.inputTokens || 0) + Number(s.cachedTokens || 0))) * 100 : 0;
        appendCell(tr, cachePct.toFixed(1) + '%', 'num');
        appendCell(tr, s.avgLatencyMs, 'num');
        const detailTr = document.createElement('tr');
        detailTr.style.display = 'none';
        const detailTd = document.createElement('td');
        detailTd.colSpan = 9;
        detailTd.appendChild(createSessionDetailContent(s));
        detailTr.appendChild(detailTd);
        toggleButton.addEventListener('click', () => {
          const isClosed = detailTr.style.display === 'none';
          detailTr.style.display = isClosed ? '' : 'none';
          toggleButton.textContent = isClosed ? '▾' : '▸';
          toggleButton.title = isClosed ? 'Hide per-model details' : 'Show per-model details';
        });
        sessionsBody.appendChild(tr);
        sessionsBody.appendChild(detailTr);
      });
      const suffix = filtered.length > MAX_SESSION_ROWS ? ' (showing first ' + MAX_SESSION_ROWS + ')' : '';
      sessionCountEl.textContent = filtered.length + ' of ' + sessions.length + ' sessions' + suffix;
    }

    function formatTurnLabel(turnIndex) { return 'Turn ' + String(Number(turnIndex) + 1); }

    function renderTurnDiscovery(baseSessions) {
      const body = document.getElementById('discoveryBody');
      if (!body) return;
      const rows = turnDiscovery
        .filter(r => { const ts = Number(r.lastTimeMs || r.firstTimeMs || 0); return ts > 0 && (globalFilter.fromMs === null || ts >= globalFilter.fromMs) && (globalFilter.toMs === null || ts <= globalFilter.toMs); })
        .filter(r => !discoveryState.onlyTools || Number(r.toolCalls || 0) > 0)
        .map(r => ({ ...r, inputTotal: Number(r.inputTokens || 0) + Number(r.cachedTokens || 0) }))
        .filter(r => !discoveryState.onlyAnomalies || isDiscoveryAnomaly(r))
        .sort((a, b) => compareValues(a[discoverySort.key], b[discoverySort.key], discoverySort.dir))
        .slice(0, 120);

      body.innerHTML = '';
      if (rows.length === 0) { body.innerHTML = '<tr><td colspan="8" style="color:var(--muted);padding:12px">No turn discovery data in this range. Turn discovery requires the agent-traces.db telemetry source (not JSONL fallback). Check the status bar for the active source.</td></tr>'; return; }

      rows.forEach(r => {
        const discoveryKey = getDiscoveryKey(r);
        const tr = document.createElement('tr');
        const toggleTd = document.createElement('td');
        const toggleButton = document.createElement('button');
        toggleButton.type = 'button'; toggleButton.textContent = '▸'; toggleButton.title = 'Show turn details';
        toggleButton.style.cssText = 'width:20px;height:20px;border:1px solid var(--border);background:var(--card-bg);color:var(--fg);border-radius:3px;cursor:pointer';
        toggleTd.appendChild(toggleButton);
        tr.appendChild(toggleTd);
        appendCell(tr, formatTurnLabel(r.turnIndex));
        appendCell(tr, r.chatSessionId.length > 12 ? (r.chatSessionId.slice(0, 6) + '…' + r.chatSessionId.slice(-4)) : r.chatSessionId, '', r.chatSessionId);
        appendCell(tr, Number(r.llmCalls || 0), 'num');
        appendCell(tr, Number(r.toolCalls || 0), 'num');
        appendCell(tr, formatCompactNumber(Number(r.inputTotal || 0)), 'num');
        appendCell(tr, formatCompactNumber(Number(r.outputTokens || 0)), 'num');
        const cacheTd = document.createElement('td');
        cacheTd.className = 'num';
        const cachePct = Number(r.cacheHitPct || 0);
        cacheTd.textContent = cachePct.toFixed(1) + '%';
        if (cachePct >= 70) cacheTd.style.color = '#81c784';
        else if (cachePct >= 40) cacheTd.style.color = '#ffb74d';
        else cacheTd.style.color = '#e57373';
        tr.appendChild(cacheTd);
        const detailTr = document.createElement('tr');
        const isOpen = discoveryState.expandAll || discoveryState.expandedKeys.has(discoveryKey);
        detailTr.style.display = isOpen ? '' : 'none';
        const detailTd = document.createElement('td');
        detailTd.colSpan = 8;
        const detailWrap = document.createElement('div');
        detailWrap.style.cssText = 'padding:10px 12px;background:var(--card-bg);border:1px solid var(--border);border-radius:4px';
        const lastActive = Number(r.lastTimeMs || 0) > 0 ? new Date(Number(r.lastTimeMs)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
        const models = Array.isArray(r.models) && r.models.length > 0 ? r.models.join(', ') : 'unknown';
        const agents = Array.isArray(r.agents) && r.agents.length > 0 ? r.agents.join(', ') : 'unknown';
        const tools = Array.isArray(r.tools) && r.tools.length > 0 ? r.tools.join(', ') : 'none';
        detailWrap.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">'
          + '<div style="font-size:11px;color:var(--muted)">Last active: ' + lastActive + ' · Session: ' + r.chatSessionId + '</div>'
          + '<button class="goto-session" data-session-id="' + r.chatSessionId + '" style="font-size:11px;border:1px solid var(--border);border-radius:4px;padding:3px 8px;background:var(--card-bg);color:var(--accent);cursor:pointer">Open in Sessions</button>'
          + '</div>'
          + '<div style="margin-top:8px;font-size:12px">'
          + '<div><strong>Models:</strong> ' + models + '</div>'
          + '<div><strong>Agents:</strong> ' + agents + '</div>'
          + '<div><strong>Tools:</strong> ' + tools + '</div>'
          + '</div>';
        detailTd.appendChild(detailWrap);
        detailTr.appendChild(detailTd);
        toggleButton.addEventListener('click', () => {
          const isClosed = detailTr.style.display === 'none';
          detailTr.style.display = isClosed ? '' : 'none';
          toggleButton.textContent = isClosed ? '▾' : '▸';
          toggleButton.title = isClosed ? 'Hide turn details' : 'Show turn details';
          if (isClosed) discoveryState.expandedKeys.add(discoveryKey);
          else discoveryState.expandedKeys.delete(discoveryKey);
        });
        if (isOpen) { toggleButton.textContent = '▾'; toggleButton.title = 'Hide turn details'; }
        body.appendChild(tr);
        body.appendChild(detailTr);
      });
    }

    function jumpToSession(sessionId) {
      if (!sessionId) return;
      switchToTab('sessions');
      switchSessionPane('table');
      rerenderAll();
      const row = Array.from(document.querySelectorAll('#sessionsBody tr')).find(el => el.dataset && el.dataset.sessionId === sessionId);
      if (!row) return;
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.style.outline = '1px solid var(--accent)';
      row.style.background = 'color-mix(in srgb, var(--accent) 14%, transparent)';
      setTimeout(() => { row.style.outline = ''; row.style.background = ''; }, 1600);
    }

    const budgetModelsBody = document.getElementById('budgetModelsBody');
    function renderBudgetModels(modelRows) {
      budgetModelsBody.innerHTML = '';
      modelRows.forEach(r => {
        const tr = document.createElement('tr');
        appendCell(tr, r.model);
        appendCell(tr, r.turns, 'num');
        appendCell(tr, r.credits.toFixed(1), 'num');
        appendCell(tr, r.pct.toFixed(1) + '%', 'num');
        budgetModelsBody.appendChild(tr);
      });
    }

    function updateTokensSummary(baseSessions, modelRows, insightDays) {
      const totalInput = insightDays.reduce((sum, d) => sum + d.input, 0);
      const totalCached = insightDays.reduce((sum, d) => sum + d.cached, 0);
      const totalOutput = insightDays.reduce((sum, d) => sum + d.output, 0);
      const totalTurns = baseSessions.reduce((sum, s) => sum + Number(s.turns || 0), 0);
      const billableInput = totalInput + totalCached;
      const totalTokens = billableInput + totalOutput;
      const cacheHitPct = billableInput > 0 ? (totalCached / billableInput) * 100 : 0;
      const ioRatio = totalOutput > 0 ? Math.round(billableInput / totalOutput) : 0;
      const avgPerTurn = totalTurns > 0 ? (totalTokens / totalTurns) : 0;
      const topModel = modelRows.reduce((top, row) => { if (!top || row.cost > top.cost) return row; return top; }, null);

      setText('tokensTotalInput', formatCompactNumber(billableInput));
      setText('tokensTotalInputSub', formatCompactNumber(totalInput) + ' net + ' + formatCompactNumber(totalCached) + ' cached');
      setText('tokensTotalCached', formatCompactNumber(totalCached));
      setText('tokensTotalCachedSub', 'cache hit ' + cacheHitPct.toFixed(1) + '%');
      setText('tokensTotalOutput', formatCompactNumber(totalOutput));
      setText('tokensTotalOutputSub', 'I:O ratio ' + (totalOutput > 0 ? ioRatio + ':1' : '—:1'));
      setText('tokensAvgPerTurn', formatCompactNumber(avgPerTurn));
      setText('tokensAvgPerTurnSub', totalTurns + ' turns in range');
      if (topModel) { setText('tokensTopModel', topModel.model); setText('tokensTopModelSub', '$' + topModel.cost.toFixed(2) + ' (' + topModel.pct.toFixed(1) + '%)'); }
      else { setText('tokensTopModel', 'N/A'); setText('tokensTopModelSub', '$0.00 (0.0%)'); }
    }

    const tokensBody = document.getElementById('tokensBody');
    function renderTokens(modelRows) {
      const rows = modelRows.map(r => {
        const avgCost = r.turns > 0 ? r.cost / r.turns : 0;
        const avgCredits = r.turns > 0 ? r.credits / r.turns : 0;
        const totalCostRounded = roundHalfUp(r.cost, 2);
        return { model: r.model, turns: r.turns, totalCost: r.cost, totalCostRounded, avgCost, avgCredits };
      }).filter(r =>
        includesFilter(r.model, getTextFilter('tokensFilterModel'))
        && includesFilter(r.turns, getTextFilter('tokensFilterTurns'))
        && includesFilter(r.totalCostRounded.toFixed(2), getTextFilter('tokensFilterCost'))
        && includesFilter(r.avgCost.toFixed(4), getTextFilter('tokensFilterAvgCost'))
        && includesFilter(r.avgCredits.toFixed(2), getTextFilter('tokensFilterAvgCredits'))
      ).sort((a, b) => compareValues(a[tokensSort.key], b[tokensSort.key], tokensSort.dir));

      tokensBody.innerHTML = '';
      rows.forEach(r => {
        const tr = document.createElement('tr');
        appendCell(tr, r.model);
        appendCell(tr, r.turns, 'num');
        appendCell(tr, '$' + r.totalCostRounded.toFixed(2), 'num');
        appendCell(tr, '$' + r.avgCost.toFixed(4), 'num');
        appendCell(tr, r.avgCredits.toFixed(2), 'num');
        tokensBody.appendChild(tr);
      });
    }

    function renderModelsWithState(modelRows) {
      const rows = modelRows.filter(r =>
        includesFilter(r.model, getTextFilter('modelsFilterModel'))
        && includesFilter(r.turns, getTextFilter('modelsFilterTurns'))
        && includesFilter(r.cost.toFixed(3), getTextFilter('modelsFilterCost'))
        && includesFilter(r.pct.toFixed(1), getTextFilter('modelsFilterPct'))
        && includesFilter(r.totalTokens, getTextFilter('modelsFilterTokens'))
        && includesFilter(r.cachePct.toFixed(1), getTextFilter('modelsFilterCachePct'))
        && includesFilter(r.avgMs, getTextFilter('modelsFilterAvg'))
        && includesFilter(r.tailMs, getTextFilter('modelsFilterTail'))
      ).sort((a, b) => compareValues(a[modelsSort.key], b[modelsSort.key], modelsSort.dir));
      renderModels(rows);
    }

    function bindSortHandlers(tabId, sortState, renderFn) {
      document.querySelectorAll('#' + tabId + ' th.sortable').forEach(th => {
        th.addEventListener('click', () => {
          const key = th.dataset.sort;
          if (!key) return;
          if (sortState.key === key) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
          else { sortState.key = key; sortState.dir = 'desc'; }
          renderFn();
        });
      });
    }

    function bindFilterInputs(ids, renderFn) {
      ids.forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('input', renderFn); });
    }

    function rerenderAll() {
      const baseSessions = getFilteredSessionsBase();
      const modelRowsFromSessions = getModelRowsFromSessions(baseSessions);
      const modelRows = modelRowsFromSessions.length > 0 ? modelRowsFromSessions : getFallbackModelRows();
      const filteredDailySeries = getFilteredDailySeries();
      const filteredInsightDays = getFilteredInsightDays();
      renderSessions(baseSessions);
      renderBudgetModels(modelRows);
      renderModelsWithState(modelRows);
      renderTokens(modelRows);
      renderAgentsForRange();
      updateTokensSummary(baseSessions, modelRows, filteredInsightDays);
      updateOverviewAndBudget(baseSessions, modelRows, filteredDailySeries, filteredInsightDays);
      renderInsightsFromRange(baseSessions);
      renderTurnDiscovery(baseSessions);
      document.getElementById('globalRangeSummary').textContent = getRangeSummary(globalFilter.fromMs, globalFilter.toMs);
    }

    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const btn = target.closest('.goto-session');
      if (!(btn instanceof HTMLElement)) return;
      const sessionId = btn.dataset.sessionId || '';
      if (sessionId) jumpToSession(sessionId);
    });

    const discoveryExpandAllBtn = document.getElementById('discoveryExpandAll');
    const discoveryCollapseAllBtn = document.getElementById('discoveryCollapseAll');
    const discoveryOnlyToolsEl = document.getElementById('discoveryOnlyTools');
    const discoveryOnlyAnomaliesEl = document.getElementById('discoveryOnlyAnomalies');

    if (discoveryOnlyToolsEl) { discoveryOnlyToolsEl.checked = discoveryState.onlyTools; discoveryOnlyToolsEl.addEventListener('change', () => { discoveryState.onlyTools = Boolean(discoveryOnlyToolsEl.checked); rerenderAll(); }); }
    if (discoveryOnlyAnomaliesEl) { discoveryOnlyAnomaliesEl.checked = discoveryState.onlyAnomalies; discoveryOnlyAnomaliesEl.addEventListener('change', () => { discoveryState.onlyAnomalies = Boolean(discoveryOnlyAnomaliesEl.checked); rerenderAll(); }); }
    if (discoveryExpandAllBtn) { discoveryExpandAllBtn.addEventListener('click', () => { discoveryState.expandAll = true; rerenderAll(); }); }
    if (discoveryCollapseAllBtn) { discoveryCollapseAllBtn.addEventListener('click', () => { discoveryState.expandAll = false; discoveryState.expandedKeys.clear(); rerenderAll(); }); }

    bindSortHandlers('tab-sessions', sessionsSort, rerenderAll);
    bindSortHandlers('tab-models', modelsSort, rerenderAll);
    bindSortHandlers('tab-tokens', tokensSort, rerenderAll);
    bindSortHandlers('sessions-pane-discovery', discoverySort, rerenderAll);

    bindFilterInputs(['sessionsFilterDate','sessionsFilterModel','sessionsFilterTurns','sessionsFilterCost','sessionsFilterCredits','sessionsFilterTokens','sessionsFilterCachePct','sessionsFilterLatency'], rerenderAll);
    bindFilterInputs(['modelsFilterModel','modelsFilterTurns','modelsFilterCost','modelsFilterPct','modelsFilterTokens','modelsFilterCachePct','modelsFilterAvg','modelsFilterTail'], rerenderAll);
    bindFilterInputs(['tokensFilterModel','tokensFilterTurns','tokensFilterCost','tokensFilterAvgCost','tokensFilterAvgCredits'], rerenderAll);

    document.querySelectorAll('#overviewChartMode button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#overviewChartMode button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        overviewChartMode = btn.dataset.mode || 'cost';
        rerenderAll();
      });
    });

    document.querySelectorAll('.global-filter-bar .preset').forEach(btn => {
      btn.addEventListener('click', () => { applyPreset(btn.dataset.preset || 'period'); });
    });

    document.getElementById('globalApply').addEventListener('click', () => {
      const fromVal = document.getElementById('globalFrom').value;
      const toVal = document.getElementById('globalTo').value;
      globalFilter.preset = 'custom';
      globalFilter.fromMs = fromVal ? new Date(fromVal).getTime() : null;
      globalFilter.toMs = toVal ? new Date(toVal).getTime() + 59999 : null;
      document.querySelectorAll('.global-filter-bar .preset').forEach(btn => btn.classList.remove('active'));
      rerenderAll();
    });

    document.getElementById('globalReset').addEventListener('click', () => { applyPreset('period'); });

    const heatmapData = ${v.heatmapData};
    const heatmapGrid = document.getElementById('heatmapGrid');
    const costColors = ['var(--border)', '#0e4429', '#006d32', '#26a641', '#39d353'];
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const CELL_STEP = 15;

    function renderHeatmap(mode) {
      const numWeeks = Math.ceil(heatmapData.length / 7);
      const monthsEl = document.getElementById('heatmapMonths');
      monthsEl.innerHTML = '';
      let lastMonth = -1;
      for (let week = 0; week < numWeeks; week++) {
        const idx = week * 7;
        const span = document.createElement('span');
        span.style.minWidth = CELL_STEP + 'px';
        span.style.display = 'inline-block';
        if (idx < heatmapData.length) {
          const d = new Date(heatmapData[idx].date + 'T00:00:00');
          const month = d.getMonth();
          if (month !== lastMonth) { span.textContent = MONTH_NAMES[month]; lastMonth = month; }
        }
        monthsEl.appendChild(span);
      }
      const dayLabelsEl = document.getElementById('heatmapDayLabels');
      dayLabelsEl.innerHTML = '';
      ['Mon','','Wed','','Fri','',''].forEach(name => {
        const span = document.createElement('span');
        span.className = 'heatmap-day-label';
        span.textContent = name;
        dayLabelsEl.appendChild(span);
      });
      heatmapGrid.innerHTML = '';
      const values = heatmapData.map(d => mode === 'cost' ? d.cost : d.turns);
      const maxVal = Math.max(...values, 0.001);
      for (let week = 0; week < numWeeks; week++) {
        const col = document.createElement('div');
        col.className = 'heatmap-col';
        for (let day = 0; day < 7; day++) {
          const idx = week * 7 + day;
          const cell = document.createElement('div');
          cell.className = 'heatmap-cell';
          if (idx < values.length) {
            const intensity = values[idx] / maxVal;
            const level = intensity === 0 ? 0 : intensity < 0.25 ? 1 : intensity < 0.5 ? 2 : intensity < 0.75 ? 3 : 4;
            cell.style.background = costColors[level];
            cell.title = heatmapData[idx].date + ': ' + (mode === 'cost' ? '$' + values[idx].toFixed(3) : values[idx] + ' turns');
          }
          col.appendChild(cell);
        }
        heatmapGrid.appendChild(col);
      }
    }

    renderHeatmap('cost');
    document.querySelectorAll('#heatmapToggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#heatmapToggle button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderHeatmap(btn.dataset.mode);
      });
    });

    const ioRatioLabels = ${v.ioRatioLabels};
    const ioNetInputData = ${v.ioNetInput};
    const ioCachedData = ${v.ioCached};
    const ioOutputData = ${v.ioOutput};

    const tokenTrendChartInst = new Chart(document.getElementById('tokenTrendChart'), {
      type: 'bar',
      data: {
        labels: ioRatioLabels,
        datasets: [
          { label: 'Cached Input', data: ioCachedData, backgroundColor: 'rgba(79,195,247,0.55)', stack: 'input' },
          { label: 'Net Input', data: ioNetInputData, backgroundColor: 'rgba(79,195,247,0.25)', stack: 'input' },
          { label: 'Output', data: ioOutputData, backgroundColor: 'rgba(129,199,132,0.75)', stack: 'output' },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked: true, ticks: { color: textColor, maxTicksLimit: 8, font: { size: 10 } }, grid: { color: gridColor } },
          y: { stacked: false, ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor }, title: { display: true, text: 'Tokens', color: textColor, font: { size: 10 } } }
        },
        plugins: { legend: { labels: { color: textColor, font: { size: 11 } } } }
      }
    });

    function getFilteredInsightDays() {
      const days = [];
      for (let i = 0; i < ioRatioLabels.length; i++) {
        const dayTs = new Date(ioRatioLabels[i] + 'T00:00:00').getTime();
        const dayEndTs = dayTs + 86399999;
        if ((globalFilter.fromMs === null || dayEndTs >= globalFilter.fromMs) && (globalFilter.toMs === null || dayTs <= globalFilter.toMs)) {
          days.push({ period: ioRatioLabels[i], input: Number(ioNetInputData[i] || 0), cached: Number(ioCachedData[i] || 0), output: Number(ioOutputData[i] || 0) });
        }
      }
      return days;
    }

    function renderInsightsFromRange(baseSessions) {
      const insightDays = getFilteredInsightDays();
      const totalInput = insightDays.reduce((sum, d) => sum + d.input, 0);
      const totalCached = insightDays.reduce((sum, d) => sum + d.cached, 0);
      const totalOutput = insightDays.reduce((sum, d) => sum + d.output, 0);
      const totalBillableInput = totalInput + totalCached;
      const totalTurns = baseSessions.reduce((sum, s) => sum + Number(s.turns || 0), 0);
      const cacheHitPct = totalBillableInput > 0 ? (totalCached / totalBillableInput) * 100 : 0;
      const avgInputPerTurn = totalTurns > 0 ? Math.round((totalBillableInput / totalTurns) / 100) / 10 : 0;
      const ioRatio = totalOutput > 0 ? Math.round(totalBillableInput / totalOutput) + ':1' : '—:1';
      const cacheColor = cacheHitPct >= 70 ? '#81c784' : cacheHitPct >= 40 ? '#ffb74d' : '#e57373';
      const avgNote = avgInputPerTurn > 20 ? 'High context load in this range' : 'within normal range';

      setText('insightCacheHitValue', cacheHitPct.toFixed(1) + '%');
      setText('insightCacheHitSub', (totalCached / 1000).toFixed(0) + 'K cached of ' + (totalBillableInput / 1000).toFixed(0) + 'K total input');
      const cacheHitValueEl = document.getElementById('insightCacheHitValue');
      if (cacheHitValueEl) cacheHitValueEl.style.color = cacheColor;
      const cacheHitFillEl = document.getElementById('insightCacheHitFill');
      if (cacheHitFillEl) { cacheHitFillEl.style.width = Math.min(100, cacheHitPct).toFixed(1) + '%'; cacheHitFillEl.style.background = cacheColor; }
      setText('insightIoRatioValue', ioRatio);
      setText('insightIoRatioSub', (totalBillableInput / 1000).toFixed(0) + 'K in · ' + (totalOutput / 1000).toFixed(0) + 'K out');
      setText('insightAvgInputValue', avgInputPerTurn.toFixed(1) + 'K');
      setText('insightAvgInputSub', avgNote);
      const avgInputEl = document.getElementById('insightAvgInputValue');
      if (avgInputEl) avgInputEl.style.cssText = avgInputPerTurn > 20 ? 'color:#e57373' : '';
      setText('insightTokenFlowTitle', 'Token Flow — ' + getRangePresetLabel() + ' (stacked)');
      tokenTrendChartInst.data.labels = insightDays.map(d => d.period);
      tokenTrendChartInst.data.datasets[0].data = insightDays.map(d => d.cached);
      tokenTrendChartInst.data.datasets[1].data = insightDays.map(d => d.input);
      tokenTrendChartInst.data.datasets[2].data = insightDays.map(d => d.output);
      tokenTrendChartInst.update();

      const rangeAlerts = [];
      if (cacheHitPct < 40 && totalBillableInput > 5000) rangeAlerts.push('Low cache reuse in this range. Keep related tasks in one session to improve hit rate.');
      if (avgInputPerTurn > 20) rangeAlerts.push('High input per turn. Reduce attached context and split very broad prompts.');
      if (totalOutput > 0 && (totalBillableInput / Math.max(1, totalOutput)) > 8) rangeAlerts.push('High input-to-output ratio. Consider tighter prompts and smaller context windows.');
      const alertsContainer = document.getElementById('insightsRangeAlerts');
      if (alertsContainer) {
        alertsContainer.innerHTML = rangeAlerts.length === 0
          ? '<div style="padding:8px 10px;border:1px solid var(--border);border-radius:4px;background:var(--card-bg);font-size:12px;color:var(--muted)">No range-specific token concerns detected.</div>'
          : rangeAlerts.map((msg, idx) => '<div style="padding:8px 10px;border:1px solid var(--border);border-left:3px solid #ffb74d;border-radius:4px;background:var(--card-bg);font-size:12px;margin-bottom:6px"><strong>Token Alert ' + (idx + 1) + ':</strong> ' + msg + '</div>').join('');
      }
    }

    const surfaceLabels = ${v.surfaceLabels};
    const surfaceInputs = ${v.surfaceInputs};
    if (surfaceLabels.length > 0) {
      new Chart(document.getElementById('surfacePieChart'), {
        type: 'doughnut',
        data: { labels: surfaceLabels, datasets: [{ data: surfaceInputs, backgroundColor: colors.slice(0, surfaceLabels.length) }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: textColor, font: { size: 11 } }, position: 'right' } } }
      });
    }

    const surfaceCostLabels = ${v.surfaceCostLabels};
    const surfaceCostData = ${v.surfaceCostData};
    if (surfaceCostLabels.length > 0) {
      new Chart(document.getElementById('surfaceCostPieChart'), {
        type: 'doughnut',
        data: { labels: surfaceCostLabels, datasets: [{ data: surfaceCostData, backgroundColor: colors.slice(0, surfaceCostLabels.length) }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: textColor, font: { size: 11 } }, position: 'right' },
            tooltip: { callbacks: { label: (ctx) => { const total = ctx.dataset.data.reduce((a, b) => a + b, 0); const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0'; return ctx.label + ': $' + ctx.parsed.toFixed(3) + ' (' + pct + '%)'; } } }
          }
        }
      });
    }

    renderAgentsForRange();
    applyPreset('period');
  </script>`;
}
