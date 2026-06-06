export interface DashboardMessage {
  type: 'dashboardData';
  data: DashboardRawData;
}

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
  allSessions: Array<{
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
    modelBreakdown: Array<{
      model: string;
      turnCount: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalCachedTokens: number;
      totalCostUsd: number;
      totalCredits: number;
    }>;
  }>;
  billingPeriodStartMs: number;
  billingPeriodEndMs: number;
  periodCredits: number;
  periodAggregate: { costUsd: number; credits: number; turns: number };
  budgetCredits: number;
}

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
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  tip: string;
  metric: { label: string; value: string };
}

export interface PlaybookRow {
  strategy: string;
  statusEmoji: string;
  statusLabel: string;
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
