export interface StoredTurn {
  id: number;
  sessionId: string;
  timestamp: number;
  duration: number;
  agentName: string;
  model: string;
  modelFamily: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  credits: number;
  workspace: string;
  status: string;
}

export interface SessionSummary {
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
}

export interface SessionModelBreakdownRow {
  sessionId: string;
  model: string;
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalCostUsd: number;
  totalCredits: number;
}

export interface AggregatedCost {
  period: string;
  totalCostUsd: number;
  totalCredits: number;
  turnCount: number;
}

export interface ModelBreakdown {
  model: string;
  totalCostUsd: number;
  totalCredits: number;
  turnCount: number;
  percentage: number;
}

export interface AgentBreakdown {
  agentName: string;
  totalCostUsd: number;
  totalCredits: number;
  turnCount: number;
  percentage: number;
}

export interface DailyAgentBreakdown {
  period: string;
  agentName: string;
  totalCostUsd: number;
  totalCredits: number;
  turnCount: number;
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

export interface ModelLatencySample {
  model: string;
  duration: number;
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

export interface AlertMetrics {
  avgOutputTokensToday: number;
  turnsToday: number;
  maxSessionInputTokens: number;
  maxIdleGapMs: number;
  microTurnCount: number;
  microTurnAvgOutput: number;
  rawPasteMaxNetInput: number;
  premiumMisallocationCount: number;
  premiumMisallocationAvgCredits: number;
  massiveContextMaxInput: number;
}

export interface AlertThresholdConfig {
  microTurnGapMs: number;
  microTurnMinCount: number;
  microTurnMaxOutputTokens: number;
  rawPasteMinInputTokens: number;
  premiumMisallocationMinCredits: number;
  premiumMisallocationMaxOutputTokens: number;
  agentSprawlMinInputTokens: number;
}

export interface AlertMetricAccumulator {
  microTurnCount: number;
  microTurnOutputTotal: number;
  rawPasteMaxNetInput: number;
  premiumMisallocationCount: number;
  premiumMisallocationCreditsTotal: number;
  massiveContextMaxInput: number;
  previousSessionId: string | null;
  previousTimestamp: number;
}
