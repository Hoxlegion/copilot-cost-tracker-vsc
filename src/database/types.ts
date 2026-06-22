import type { ParsedTurn } from "../parser/types";

// ── Role interfaces ───────────────────────────────────
// Consumers import only the slice they need, reducing coupling.

/** Read-only query access to cost data. */
export interface CostReader {
  getSessionSummaries(workspace?: string, limit?: number): SessionSummary[];
  getSessionModelBreakdowns(sessionIds: string[]): SessionModelBreakdownRow[];
  getTurnsForSession(sessionId: string, limit?: number): StoredTurn[];
  getModelLatencySamples(days?: number, workspace?: string): ModelLatencySample[];
  getDailyCosts(days?: number, workspace?: string): AggregatedCost[];
  getDailyCostsSince(sinceMs: number, workspace?: string): AggregatedCost[];
  getModelBreakdown(days?: number, workspace?: string): ModelBreakdown[];
  getModelBreakdownSince(sinceMs: number, workspace?: string): ModelBreakdown[];
  getAgentBreakdown(days?: number, workspace?: string): AgentBreakdown[];
  getAgentBreakdownSince(sinceMs: number, workspace?: string): AgentBreakdown[];
  getDailyAgentBreakdown(days?: number, workspace?: string): DailyAgentBreakdown[];
  getCurrentMonthTotal(workspace?: string): { costUsd: number; credits: number; turns: number };
  getCreditsSince(sinceMs: number): number;
  getMostRecentModel(): string | null;
  getCostSince(sinceMs: number, workspace?: string): { costUsd: number; credits: number; turns: number };
  getWorkspaces(): string[];
  getInsightMetrics(days?: number): InsightMetrics;
  getAlertMetrics(sinceMs: number, thresholds?: Partial<AlertThresholdConfig>): AlertMetrics;
  getCacheSavingsMetrics(
    sinceMs: number,
    workspace?: string,
    calculateSavingsCost?: (modelFamily: string, writeTokens: number, readTokens: number) => number,
  ): CacheSavingsMetrics;
  getMostRecentSessionContext(sinceMs: number): SessionContextInfo | null;
  getSessionContextTimeline(sessionId: string): ContextTimelinePoint[];
  getSessionContextDistribution(sinceMs: number): SessionContextDistribution[];
}

/** Write access for ingestion and session management. */
export interface CostWriter {
  insertTurn(turn: ParsedTurn, costUsd: number, credits: number, workspace: string): void;
  markSessionProcessed(
    sessionId: string, workspace: string, startTimestamp: number, lastTimestamp: number,
    copilotVersion: string, vscodeVersion: string, title?: string,
  ): void;
  updateSessionTitles(titles: Map<string, string>): void;
  isSessionProcessed(sessionId: string): boolean;
  getSessionLastTimestamp(sessionId: string): number | null;
  getMaxTimestamp(): number;
  beginTransaction(): void;
  commitTransaction(): void;
  rollbackTransaction(): void;
  runLegacySessionDedupMigration(): void;
}

/** Lifecycle and maintenance operations. */
export interface CostMaintenance {
  initialize(): Promise<void>;
  save(): Promise<void>;
  pruneOldTurns(retentionDays: number): number;
  recomputeCacheTokenSemantics(
    recost: (turn: {
      modelFamily: string;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      cacheWriteTokens: number;
    }) => { costUsd: number; credits: number }
  ): boolean;
  close(): void;
  readonly didRecoverFromCorruption: boolean;
}

// ── Data types ────────────────────────────────────────

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
  costSource: "real" | "estimated";
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
  title: string | null;
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

export interface SessionContextInfo {
  sessionId: string;
  turnCount: number;
  lastActivityMs: number;
  firstActivityMs: number;
  currentContextWeight: number;
}

export interface ContextTimelinePoint {
  timestamp: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  currentContextWeight: number;
}

export interface SessionContextDistribution {
  sessionId: string;
  currentContextWeight: number;
  turnCount: number;
  startMs: number;
  lastMs: number;
  totalCost: number;
  workspace: string;
}
