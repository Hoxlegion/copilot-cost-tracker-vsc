/**
 * Shared types for the dashboard data contract between extension host and webview.
 *
 * Both sides import from this file to guarantee compile-time type safety
 * across the postMessage() boundary.
 */

// ── Aggregated sub-types ──────────────────────────────

export interface InsightMetrics {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  errorTurns: number;
  totalTurns: number;
  cacheHitPct: number;
  ioRatioDays: Array<{ period: string; inputTokens: number; outputTokens: number; cachedTokens: number }>;
}

export interface CacheSavingsMetrics {
  totalCacheWriteTokens: number;
  totalCacheReadTokens: number;
  totalSavingsCostUsd: number;
  totalSavingsCredits: number;
  byModel: Array<{
    modelFamily: string;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    savingsCostUsd: number;
    savingsCredits: number;
    percentage: number;
  }>;
}

export interface DashboardAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  tip: string;
  metric: { label: string; value: string };
}

export interface PlaybookRow {
  strategy: string;
  statusEmoji: string;
  statusLabel: string;
  level: "ok" | "warning" | "critical";
  metricDesc: string;
  impact: string;
}

export interface SurfaceBreakdown {
  label: string;
  agentName: string | null;
  spanCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface TurnDiscoveryRow {
  chatSessionId: string;
  turnIndex: number;
  firstTimeMs: number;
  lastTimeMs: number;
  llmCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheHitPct: number;
  models: string[];
  agents: string[];
  tools: string[];
}

export interface ContextDistributionItem {
  sessionId: string;
  currentContextWeight: number;
  turnCount: number;
  startMs: number;
  lastMs: number;
  totalCost: number;
  workspace: string;
}

export interface ContextTimelineData {
  sessionId: string;
  workspace: string;
  startMs: number;
  turns: Array<{
    timestamp: number;
    inputTokens: number;
    cachedTokens: number;
    currentContextWeight: number;
  }>;
}

// ── Session breakdown (inline in allSessions) ─────────

export interface SessionModelBreakdownEntry {
  model: string;
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalCostUsd: number;
  totalCredits: number;
}

export interface SessionEntry {
  sessionId: string;
  workspace: string;
  startTimestamp: number;
  lastTimestamp: number;
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalCostUsd: number;
  totalCredits: number;
  primaryModel: string;
  avgDurationMs: number;
  title?: string | null;
  modelBreakdown: SessionModelBreakdownEntry[];
}

// ── Top-level dashboard payload ───────────────────────

export interface DashboardRawData {
  insightMetrics: InsightMetrics;
  alerts: DashboardAlert[];
  playbook: PlaybookRow[];
  surfaceData: SurfaceBreakdown[];
  turnDiscovery: TurnDiscoveryRow[];
  cacheSavings: CacheSavingsMetrics;
  monthTotal: { costUsd: number; credits: number; turns: number };
  dailyCosts: Array<{ period: string; totalCostUsd: number; totalCredits: number; turnCount: number }>;
  dailyCostsForRange: Array<{ period: string; totalCostUsd: number; totalCredits: number; turnCount: number }>;
  insightMetricsFullRange: InsightMetrics;
  modelBreakdown: Array<{ model: string; totalCostUsd: number; totalCredits: number; turnCount: number; percentage: number }>;
  agentBreakdown: Array<{ agentName: string; totalCostUsd: number; totalCredits: number; turnCount: number; percentage: number }>;
  dailyAgentBreakdown: Array<{ period: string; agentName: string; totalCostUsd: number; totalCredits: number; turnCount: number }>;
  allSessions: SessionEntry[];
  billingPeriodStartMs: number;
  billingPeriodEndMs: number;
  periodCredits: number;
  periodAggregate: { costUsd: number; credits: number; turns: number };
  budgetCredits: number;
  lastUpdatedMs: number;
  contextDistribution: ContextDistributionItem[];
  contextTimelines: ContextTimelineData[];
  currency: string;
  exchangeRate: number;
}

export interface DashboardMessage {
  type: "dashboardData";
  data: DashboardRawData;
}
