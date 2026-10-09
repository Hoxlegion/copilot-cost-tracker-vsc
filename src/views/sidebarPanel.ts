import * as vscode from "vscode";
import { randomBytes } from "crypto";
import { CostReader, SessionSummary } from "../database";
import { PricingEngine } from "../pricing";
import { ConfigManager } from "../config";
import { getBillingPeriodStartMs, getBillingPeriodEndMs } from "../billing";
import { simplifyModelName, formatDuration } from "./treeViewFormatting";
import { formatAgentName } from "../parser/surfaceLabels";
import type { TurnSource } from "../parser/types";
import { resolveWorkspaceName } from "./helpers/workspaceResolver";

/**
 * Rich webview sidebar replacing the boring TreeDataProvider.
 * Renders a styled HTML panel with usage stats, pace, breakdowns, and sessions.
 */
export class SidebarPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = "copilotCostTracker.overview";

  private view?: vscode.WebviewView;
  private readonly database: CostReader;
  private readonly pricing: PricingEngine;
  private readonly configManager: ConfigManager;

  constructor(database: CostReader, pricing: PricingEngine, configManager: ConfigManager) {
    this.database = database;
    this.pricing = pricing;
    this.configManager = configManager;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.command === "refresh") {
        vscode.commands.executeCommand("copilotCostTracker.refresh");
      } else if (msg.command === "openDashboard") {
        vscode.commands.executeCommand("copilotCostTracker.openDashboard");
      } else if (msg.command === "ready") {
        this.postUpdate();
      }
    });

    // Set the shell HTML once; subsequent refreshes push data via postMessage
    // so the webview updates in place (no flicker or scroll reset).
    webviewView.webview.html = this.buildShellHtml();
    this.postUpdate();
  }

  refresh(): void {
    this.postUpdate();
  }

  private postUpdate(): void {
    if (!this.view) return;
    this.view.webview.postMessage({ type: "update", html: this.buildContentHtml() });
  }

  // ── Data gathering ──────────────────────────────────────

  private fmtUsd(amount: number): string {
    const { currency, exchangeRate } = this.configManager.config;
    return formatMoney(amount, currency, exchangeRate);
  }

  private getData() {
    const { budgetCredits, billingCycleStartDay, includeCliInBudget } = this.configManager.config;
    const periodStartMs = getBillingPeriodStartMs(billingCycleStartDay);
    const periodEndMs = getBillingPeriodEndMs(billingCycleStartDay);
    // Usage totals follow what counts toward the budget.
    const source: TurnSource | undefined = includeCliInBudget ? undefined : "chat";

    const period = this.database.getCostSince(periodStartMs, undefined, source);
    const today = this.getToday(source);
    const yesterday = this.getYesterday(source);
    const week = this.getWeek(source);
    const models = this.database.getModelBreakdownSince(periodStartMs, undefined, source);
    const agents = this.database.getAgentBreakdownSince(periodStartMs, undefined, source);
    const sessions = this.database.getSessionSummaries(undefined, 10);
    const bySource = this.database.getCostBySourceSince(periodStartMs);
    const cliSessionsWithoutUsage = this.database.countCliSessionsWithoutUsage(periodStartMs);

    const msDay = 86400000;
    const totalDays = Math.max(1, Math.ceil((periodEndMs - periodStartMs) / msDay));
    const daysSince = Math.max(1, Math.ceil((Date.now() - periodStartMs) / msDay));
    const daysRemaining = Math.max(0, Math.ceil((periodEndMs - Date.now()) / msDay));
    const burnRate = daysSince > 0 ? period.credits / daysSince : 0;
    const projected = burnRate * totalDays;

    const workspaces = this.database.getWorkspaces();
    const wsBreakdown = workspaces.length > 1
      ? workspaces.map((ws) => {
          const data = this.database.getCostSince(periodStartMs, ws, source);
          return { name: resolveWorkspaceName(ws), ...data };
        }).filter((ws) => ws.turns > 0).sort((a, b) => b.credits - a.credits)
      : [];

    const daily14 = this.getDailySeries(14, source);

    return {
      budgetCredits,
      billingCycleStartDay,
      includeCliInBudget,
      period,
      today,
      yesterday,
      week,
      models,
      agents,
      sessions,
      chatCredits: bySource.find((s) => s.source === "chat")?.credits ?? 0,
      cliCredits: bySource.find((s) => s.source === "cli")?.credits ?? 0,
      cliSessionsWithoutUsage,
      totalDays,
      daysSince,
      daysRemaining,
      burnRate,
      projected,
      wsBreakdown,
      daily14,
    };
  }

  /**
   * Daily credit totals for the last `days` calendar days (UTC, oldest → newest),
   * with missing days filled as 0. Used to render the sidebar sparkline.
   */
  private getDailySeries(days: number, source?: TurnSource): number[] {
    const rows = this.database.getDailyCosts(days + 1, undefined, source);
    const map = new Map(rows.map((r) => [r.period, r.totalCredits]));
    const out: number[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const key = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      out.push(map.get(key) ?? 0);
    }
    return out;
  }

  private getToday(source?: TurnSource) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return this.database.getCostSince(start, undefined, source);
  }

  private getYesterday(source?: TurnSource) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;
    const sinceYesterday = this.database.getCostSince(yesterdayStart, undefined, source);
    const today = this.database.getCostSince(todayStart, undefined, source);
    return {
      costUsd: sinceYesterday.costUsd - today.costUsd,
      credits: sinceYesterday.credits - today.credits,
      turns: sinceYesterday.turns - today.turns,
    };
  }

  private getWeek(source?: TurnSource) {
    const now = new Date();
    const dow = now.getDay();
    const weekStartDay = this.configManager.config.weekStartDay;
    const offset =
      weekStartDay === "sunday" ? dow : dow === 0 ? 6 : dow - 1;
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset).getTime();
    return this.database.getCostSince(weekStart, undefined, source);
  }

  // ── HTML rendering ──────────────────────────────────────

  private buildShellHtml(): string {
    const nonce = this.getNonce();
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>${this.getStyles()}</style>
</head>
<body>
  <div class="sidebar">
    <div id="content">
      <div class="status-bar"><span class="status-dot"></span><span>Loading…</span></div>
    </div>

    <!-- Actions -->
    <div class="section-divider"></div>
    <div class="actions">
      <button id="btnDashboard">Open Dashboard</button>
      <button id="btnRefresh">Refresh</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    function post(cmd) { vscode.postMessage({ command: cmd }); }
    document.getElementById('btnDashboard').addEventListener('click', () => post('openDashboard'));
    document.getElementById('btnRefresh').addEventListener('click', () => post('refresh'));
    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg && msg.type === 'update') {
        document.getElementById('content').innerHTML = msg.html;
      }
    });
    post('ready');
  </script>
</body>
</html>`;
  }

  private buildContentHtml(): string {
    const d = this.getData();
    const usagePct = d.budgetCredits > 0 ? (d.period.credits / d.budgetCredits) * 100 : 0;

    let barColor = "#4fc3f7";
    if (usagePct >= 100) barColor = "#e57373";
    else if (usagePct >= 80) barColor = "#ffb74d";

    const todayTrend = this.getTodayTrend(d.yesterday.costUsd, d.today.costUsd);
    const paceHtml = this.buildPaceSection(d.period.turns, d.budgetCredits, d.projected);
    const modelsHtml = this.buildModelsRows(d.models);
    const agentsHtml = this.buildAgentsRows(d.agents);
    const breakdownHtml = this.buildBreakdownSection(modelsHtml, agentsHtml, d.models.length);
    const wsHtml = this.buildWsSection(d.wsBreakdown);
    const sessionsRows = this.buildSessionsRows(d.sessions);
    const sessionsHtml = this.buildSessionsSection(sessionsRows, d.sessions.length);
    const weekLabel = this.configManager.config.weekStartDay === "sunday" ? "Sunday" : "Monday";

    return `
    <!-- Status -->
    <div class="status-bar">
      <span class="status-dot"></span>
      <span>Tracking enabled</span>
    </div>

    <!-- Usage & Pace -->
    <div class="section-divider"></div>
    <div class="section-label primary">USAGE & PACE</div>
    
    ${d.budgetCredits > 0 ? `
      <div class="budget-block">
        <div class="budget-label">MONTHLY BUDGET</div>
        <div class="budget-row">
          <span class="budget-value">${fmtNum(d.budgetCredits)} credits</span>
          <span class="budget-reset">Resets on the ${ordinal(d.billingCycleStartDay)}</span>
        </div>
        <div class="budget-bar-track">
          <div class="budget-bar-fill" style="width:${Math.min(100, usagePct)}%;background:${barColor}"></div>
        </div>
        <div class="budget-sub">
          <span>${fmtNum(d.period.credits)} credits spent</span>
          <span>${usagePct.toFixed(0)}% used</span>
        </div>
      </div>
    ` : `
      <div class="budget-block">
        <div class="budget-label">PERIOD TOTAL</div>
        <div class="budget-value">${fmtNum(d.period.credits)} credits</div>
        <div class="budget-sub"><span>${this.fmtUsd(d.period.costUsd)}</span><span>${d.period.turns} turns</span></div>
      </div>
    `}

    <div class="twin-stats">
      <div class="twin-stat">
        <div class="section-label">TODAY</div>
        <div class="twin-value">${fmtNum(d.today.credits)}</div>
        <div class="twin-unit">credits${todayTrend ? ` ${todayTrend}` : ""}</div>
      </div>
      <div class="twin-stat">
        <div class="section-label">THIS WEEK</div>
        <div class="twin-value">${fmtNum(d.week.credits)}</div>
        <div class="twin-unit">credits (since ${weekLabel})</div>
      </div>
    </div>

    ${this.buildSourceSection(d.chatCredits, d.cliCredits, d.cliSessionsWithoutUsage, d.includeCliInBudget)}

    ${this.buildSparklineSection(d.daily14)}

    ${paceHtml}

    ${breakdownHtml}

    ${wsHtml}

    ${sessionsHtml}`;
  }

  private getNonce(): string {
    return randomBytes(16).toString("hex");
  }

  // ── Section builders ────────────────────────────────────

  private getTodayTrend(yesterdayCost: number, todayCost: number): string {
    if (yesterdayCost > 0 && todayCost > yesterdayCost) {
      return `<span class="trend up">↑ vs yesterday</span>`;
    }
    if (yesterdayCost > 0 && todayCost < yesterdayCost) {
      return `<span class="trend down">↓ vs yesterday</span>`;
    }
    return "";
  }

  private buildSourceSection(chatCredits: number, cliCredits: number, cliSessionsWithoutUsage: number, cliCounted: boolean): string {
    if (cliCredits <= 0 && cliSessionsWithoutUsage === 0) return "";
    const notCounted = cliCounted ? "" : `<div class="source-note">CLI is not counted toward the budget</div>`;
    const hint = cliSessionsWithoutUsage > 0
      ? `<div class="source-note">${cliSessionsWithoutUsage} CLI session${cliSessionsWithoutUsage === 1 ? "" : "s"} this period with missing usage data (closed without a normal exit, or an older CLI)</div>`
      : "";
    return `
      <div class="source-split">
        <div class="source-row">
          <span><span class="source-dot chat"></span>Copilot Chat</span>
          <span class="source-val">${fmtNum(chatCredits)} cr</span>
        </div>
        <div class="source-row">
          <span><span class="source-dot cli"></span>Copilot CLI</span>
          <span class="source-val">${fmtNum(cliCredits)} cr</span>
        </div>
        ${notCounted}
        ${hint}
      </div>`;
  }

  private buildSparklineSection(values: number[]): string {
    // `every` already returns true for an empty array, so this covers "no data".
    if (values.every((v) => v === 0)) return "";
    const W = 100;
    const H = 26;
    const max = Math.max(...values, 1);
    const pts = values.map((v, i) => {
      const x = values.length > 1 ? (i / (values.length - 1)) * W : 0;
      const y = H - (v / max) * (H - 3) - 1.5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = "M" + pts.join(" L");
    const area = `${line} L${W},${H} L0,${H} Z`;
    const total = values.reduce((s, v) => s + v, 0);
    return `
      <div class="spark-section">
        <div class="spark-header">
          <span class="section-label">LAST 14 DAYS</span>
          <span class="spark-total">${fmtNum(total)} cr</span>
        </div>
        <svg class="sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <path d="${area}" class="spark-area" />
          <path d="${line}" class="spark-line" />
        </svg>
      </div>`;
  }

  private buildPaceSection(turns: number, budgetCredits: number, projected: number): string {
    if (turns < 10) return "";

    const paceColor = budgetCredits > 0 && projected > budgetCredits ? "#e57373" : "#81c784";
    let paceLabel = "";
    if (budgetCredits > 0 && projected > budgetCredits) {
      paceLabel = `On pace to exceed budget by ~${fmtNum(projected - budgetCredits)} cr`;
    } else if (budgetCredits > 0) {
      paceLabel = `On pace to stay ${fmtNum(budgetCredits - projected)} cr under budget`;
    }

    return `
      <div class="pace-section">
        <div class="section-label">PACE</div>
        <div class="pace-value">${fmtNum(projected)} <span class="pace-unit">credits</span> <span class="pace-note">projected this period</span></div>
        ${paceLabel ? `<div class="pace-alert" style="color:${paceColor}">${paceLabel}</div>` : ""}
      </div>`;
  }

  private buildModelsRows(models: { model: string; totalCostUsd: number; percentage: number }[]): string {
    if (models.length === 0) return "";
    const maxCost = models[0].totalCostUsd;
    return models.slice(0, 6).map((m) => {
      const barW = maxCost > 0 ? (m.totalCostUsd / maxCost) * 100 : 0;
      return `
        <div class="breakdown-row">
          <div class="breakdown-bar" style="width:${barW}%"></div>
          <span class="breakdown-name" title="${esc(m.model)}">${esc(simplifyModelName(m.model))}</span>
          <span class="breakdown-val">${this.fmtUsd(m.totalCostUsd)}</span>
          <span class="breakdown-pct">${m.percentage.toFixed(0)}%</span>
        </div>`;
    }).join("");
  }

  private buildAgentsRows(agents: { agentName: string; totalCostUsd: number; percentage: number }[]): string {
    if (agents.length === 0) return "";
    const maxAgent = agents[0].totalCostUsd;
    return agents.slice(0, 5).map((a) => {
      const barW = maxAgent > 0 ? (a.totalCostUsd / maxAgent) * 100 : 0;
      return `
        <div class="breakdown-row">
          <div class="breakdown-bar agent-bar" style="width:${barW}%"></div>
          <span class="breakdown-name" title="${esc(a.agentName)}">${esc(formatAgentName(a.agentName))}</span>
          <span class="breakdown-val">${this.fmtUsd(a.totalCostUsd)}</span>
          <span class="breakdown-pct">${a.percentage.toFixed(0)}%</span>
        </div>`;
    }).join("");
  }

  private buildBreakdownSection(modelsHtml: string, agentsHtml: string, modelCount: number): string {
    if (!modelsHtml && !agentsHtml) return "";
    const agentsSection = agentsHtml
      ? `<div class="sub-label">Agents</div>${agentsHtml}`
      : "";
    return `
      <!-- Breakdown -->
      <div class="section-divider"></div>
      <div class="collapse-section">
        <details>
          <summary class="section-header">BREAKDOWN <span class="badge">${modelCount} models</span></summary>
          <div class="section-body">
            ${modelsHtml}
            ${agentsSection}
          </div>
        </details>
      </div>`;
  }

  private buildWsSection(wsBreakdown: { name: string; costUsd: number; credits: number; turns: number }[]): string {
    if (wsBreakdown.length <= 1) return "";
    const maxWs = wsBreakdown[0].credits;
    return `
      <div class="section-divider"></div>
      <div class="collapse-section">
        <details>
          <summary class="section-header">WORKSPACES <span class="badge">${wsBreakdown.length}</span></summary>
          <div class="section-body">
            ${wsBreakdown.slice(0, 8).map((ws) => {
              const barW = maxWs > 0 ? (ws.credits / maxWs) * 100 : 0;
              return `
                <div class="breakdown-row">
                  <div class="breakdown-bar ws-bar" style="width:${barW}%"></div>
                  <span class="breakdown-name" title="${esc(ws.name)}">${esc(ws.name)}</span>
                  <span class="breakdown-val">${this.fmtUsd(ws.costUsd)}</span>
                  <span class="breakdown-pct">${ws.turns} t</span>
                </div>`;
            }).join("")}
          </div>
        </details>
      </div>`;
  }

  private buildSessionsRows(sessions: SessionSummary[]): string {
    return sessions.map((s) => {
      const time = new Date(s.lastTimestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const model = simplifyModelName(s.primaryModel);
      const wsName = resolveWorkspaceName(s.workspace);
      const isExpensive = s.totalCostUsd >= 50;
      const costClass = isExpensive ? "session-cost expensive" : "session-cost";
      const isCli = s.source === "cli";
      const titleLine = s.title
        ? `<div class="session-title" title="${esc(s.title)}">${esc(s.title)}</div>`
        : "";
      // CLI rows include usage snapshots without timing, so an average latency would mislead.
      const latency = isCli
        ? ""
        : `<span class="session-sep">·</span><span>${formatDuration(s.avgDurationMs)} avg</span>`;
      return `
        <div class="session-row${isExpensive ? " expensive" : ""}">
          <div class="session-top">
            <span class="session-time">${time}</span>
            ${isCli ? `<span class="source-badge">CLI</span>` : ""}
            <span class="session-ws" title="${esc(s.workspace)}">${esc(wsName)}</span>
            <span class="${costClass}">${this.fmtUsd(s.totalCostUsd)}</span>
          </div>
          ${titleLine}
          <div class="session-bottom">
            <span class="session-model">${esc(model)}</span>
            <span class="session-sep">·</span>
            <span>${s.turnCount} turns</span>
            ${latency}
          </div>
        </div>`;
    }).join("");
  }

  private buildSessionsSection(sessionsHtml: string, count: number): string {
    if (!sessionsHtml) return "";
    return `
      <!-- Sessions -->
      <div class="section-divider"></div>
      <div class="collapse-section">
        <details>
          <summary class="section-header">SESSIONS <span class="badge">${count} recent</span></summary>
          <div class="section-body">
            ${sessionsHtml}
          </div>
        </details>
      </div>`;
  }

  private getStyles(): string {
    return `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
        font-size: 12px;
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background, var(--vscode-editor-background));
        overflow-y: auto;
        font-variant-numeric: tabular-nums;
      }
      .sidebar { padding: 12px 14px; }

      /* ── Status bar ── */
      .status-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 0;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }
      .status-dot {
        width: 7px; height: 7px;
        border-radius: 50%;
        background: #81c784;
        box-shadow: 0 0 4px rgba(129, 199, 132, 0.5);
      }

      /* ── Section dividers ── */
      .section-divider {
        height: 1px;
        background: var(--vscode-panel-border);
        margin: 12px 0;
      }

      .section-label {
        font-size: 10px;
        font-weight: 700;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        letter-spacing: 0.8px;
        margin-bottom: 8px;
      }
      .section-label.primary {
        color: var(--vscode-foreground);
        font-size: 11px;
        letter-spacing: 0.5px;
        border-left: 3px solid #4fc3f7;
        padding-left: 8px;
        margin-bottom: 12px;
      }

      /* ── Budget block ── */
      .budget-block { margin-bottom: 16px; }
      .budget-label {
        font-size: 10px;
        font-weight: 600;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 4px;
      }
      .budget-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }
      .budget-value {
        font-size: 18px;
        font-weight: 800;
        color: var(--vscode-foreground);
      }
      .budget-reset {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
      }
      .budget-bar-track {
        width: 100%;
        height: 6px;
        background: rgba(255, 255, 255, 0.06);
        border-radius: 3px;
        margin: 8px 0 6px;
        overflow: hidden;
      }
      .budget-bar-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.3s ease;
      }
      .budget-sub {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      /* ── Twin stat cards ── */
      .twin-stats {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-bottom: 12px;
      }
      .twin-stat {
        background: color-mix(in srgb, var(--vscode-editor-background) 60%, var(--vscode-sideBar-background, var(--vscode-editor-background)) 40%);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 8px;
        padding: 10px 12px;
      }
      .twin-value {
        font-size: 22px;
        font-weight: 800;
        color: var(--vscode-foreground);
        line-height: 1.2;
      }
      .twin-unit {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        margin-top: 2px;
      }

      /* ── Trend ── */
      .trend {
        font-size: 10px;
        font-weight: 600;
      }
      .trend.up { color: #e57373; }
      .trend.down { color: #81c784; }

      /* ── Source split (Chat vs CLI) ── */
      .source-split { margin-bottom: 14px; }
      .source-row {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        padding: 2px 0;
        color: var(--vscode-foreground);
      }
      .source-val { font-weight: 600; }
      .source-dot {
        display: inline-block;
        width: 7px; height: 7px;
        border-radius: 50%;
        margin-right: 6px;
      }
      .source-dot.chat { background: #4fc3f7; }
      .source-dot.cli { background: #ba68c8; }
      .source-note {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        margin-top: 4px;
      }
      .source-badge {
        font-size: 9px;
        font-weight: 700;
        color: #ba68c8;
        border: 1px solid rgba(186, 104, 200, 0.5);
        border-radius: 4px;
        padding: 0 4px;
        flex-shrink: 0;
      }

      /* ── Sparkline ── */
      .spark-section { margin-bottom: 14px; }
      .spark-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: 6px;
      }
      .spark-header .section-label { margin-bottom: 0; }
      .spark-total {
        font-size: 11px;
        font-weight: 600;
        color: var(--vscode-foreground);
      }
      .sparkline {
        width: 100%;
        height: 30px;
        display: block;
      }
      .spark-line {
        fill: none;
        stroke: #4fc3f7;
        stroke-width: 1.5;
        vector-effect: non-scaling-stroke;
        stroke-linejoin: round;
      }
      .spark-area {
        fill: rgba(79, 195, 247, 0.14);
        stroke: none;
      }

      /* ── Pace ── */
      .pace-section { margin-bottom: 4px; }
      .pace-value {
        font-size: 18px;
        font-weight: 800;
        color: var(--vscode-foreground);
      }
      .pace-unit {
        font-size: 14px;
        font-weight: 600;
        color: var(--vscode-foreground);
      }
      .pace-note {
        font-size: 11px;
        font-weight: 400;
        color: var(--vscode-descriptionForeground);
      }
      .pace-alert {
        font-size: 11px;
        font-weight: 500;
        margin-top: 4px;
      }

      /* ── Collapse sections ── */
      .collapse-section { margin-bottom: 4px; }
      .section-header {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        cursor: pointer;
        user-select: none;
        padding: 6px 0;
        color: var(--vscode-foreground);
        list-style: none;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .section-header::-webkit-details-marker { display: none; }
      details[open] > .section-header::before { content: '▾'; }
      details:not([open]) > .section-header::before { content: '▸'; }
      .section-header::before {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        width: 10px;
      }
      .badge {
        font-size: 10px;
        font-weight: 500;
        color: var(--vscode-descriptionForeground);
        background: rgba(255, 255, 255, 0.06);
        padding: 1px 8px;
        border-radius: 8px;
      }
      .section-body { padding: 4px 0 8px; }

      /* ── Breakdown rows ── */
      .breakdown-row {
        display: grid;
        grid-template-columns: 1fr auto auto;
        gap: 8px;
        align-items: center;
        padding: 4px 0;
        position: relative;
        font-size: 11px;
      }
      .breakdown-bar {
        position: absolute;
        left: 0; top: 0; bottom: 0;
        background: rgba(79, 195, 247, 0.08);
        border-radius: 3px;
        pointer-events: none;
        z-index: 0;
      }
      .breakdown-bar.agent-bar {
        background: rgba(186, 104, 200, 0.08);
      }
      .breakdown-bar.ws-bar {
        background: rgba(255, 183, 77, 0.08);
      }
      .breakdown-name {
        position: relative;
        z-index: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--vscode-foreground);
      }
      .breakdown-val {
        position: relative;
        z-index: 1;
        font-weight: 600;
        color: var(--vscode-foreground);
        text-align: right;
      }
      .breakdown-pct {
        position: relative;
        z-index: 1;
        color: var(--vscode-descriptionForeground);
        text-align: right;
        min-width: 26px;
        font-size: 10px;
      }

      .sub-label {
        font-size: 10px;
        font-weight: 600;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        letter-spacing: 0.4px;
        margin: 10px 0 4px;
      }

      /* ── Session rows ── */
      .session-row {
        padding: 6px 8px;
        border-radius: 6px;
        margin-bottom: 4px;
        background: color-mix(in srgb, var(--vscode-editor-background) 60%, var(--vscode-sideBar-background, var(--vscode-editor-background)) 40%);
        border: 1px solid transparent;
        transition: border-color 0.15s ease;
      }
      .session-row:hover {
        border-color: var(--vscode-panel-border);
      }
      .session-row.expensive {
        border-left: 2px solid #e57373;
      }
      .session-top {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 3px;
      }
      .session-time {
        font-size: 10px;
        font-weight: 600;
        color: var(--vscode-descriptionForeground);
        flex-shrink: 0;
      }
      .session-ws {
        font-size: 11px;
        font-weight: 500;
        color: var(--vscode-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        min-width: 0;
      }
      .session-title {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-bottom: 2px;
        font-style: italic;
      }
      .session-cost {
        font-size: 11px;
        font-weight: 600;
        color: var(--vscode-foreground);
        flex-shrink: 0;
      }
      .session-cost.expensive { color: #e57373; }
      .session-bottom {
        display: flex;
        gap: 5px;
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
      }
      .session-model { color: #4fc3f7; font-weight: 500; }
      .session-sep { opacity: 0.3; }

      /* ── Actions ── */
      .actions {
        display: flex;
        gap: 8px;
        padding: 4px 0;
      }
      .actions button {
        flex: 1;
        padding: 6px 12px;
        background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.06));
        color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        cursor: pointer;
        font-size: 11px;
        font-weight: 500;
        transition: background 0.15s ease;
      }
      .actions button:hover {
        background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.1));
      }
    `;
  }
}

// ── Helpers ──

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 10000) return `${(n / 1000).toFixed(1)}K`;
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function formatMoney(amount: number, currency: string, exchangeRate: number): string {
  if (currency === "USD") return `$${amount.toFixed(2)}`;
  const local = amount * exchangeRate;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(local);
  } catch { return `${currency} ${local.toFixed(2)}`; }
}

function ordinal(day: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = day % 100;
  return day + (s[(v - 20) % 10] || s[v] || s[0]);
}

function esc(text: string): string {
  return text.replaceAll('&', "&amp;").replaceAll('<', "&lt;").replaceAll('>', "&gt;").replaceAll('"', "&quot;");
}
