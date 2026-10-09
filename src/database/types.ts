import type { ParsedTurn, TurnSource } from "../parser/types";

// ── Role interfaces ───────────────────────────────────
// Consumers import only the slice they need, reducing coupling.
// An omitted `source` argument means all sources (Copilot Chat and CLI).

/** Read-only query access to cost data. */
export interface CostReader {
  getSessionSummaries(workspace?: string, limit?: number, source?: TurnSource): SessionSummary[];
  getSessionModelBreakdowns(sessionIds: string[]): SessionModelBreakdownRow[];
  getTurnsForSession(sessionId: string, limit?: number): StoredTurn[];
  getAllTurns(): StoredTurn[];
  iterateAllTurns(): Iterable<StoredTurn>;
  getModelLatencySamples(days?: number, workspace?: string): ModelLatencySample[];
  getDailyCosts(days?: number, workspace?: string, source?: TurnSource): AggregatedCost[];
  getDailyCostsSince(sinceMs: number, workspace?: string, source?: TurnSource): AggregatedCost[];
  getModelBreakdown(days?: number, workspace?: string, source?: TurnSource): ModelBreakdown[];
  getModelBreakdownSince(sinceMs: number, workspace?: string, source?: TurnSource): ModelBreakdown[];
  getAgentBreakdown(days?: number, workspace?: string, source?: TurnSource): AgentBreakdown[];
  getAgentBreakdownSince(sinceMs: number, workspace?: string, source?: TurnSource): AgentBreakdown[];
  getDailyAgentBreakdown(days?: number, workspace?: string, source?: TurnSource): DailyAgentBreakdown[];
  getCurrentMonthTotal(billingStartDay?: number, workspace?: string, source?: TurnSource): { costUsd: number; credits: number; turns: number };
  getCreditsSince(sinceMs: number, source?: TurnSource): number;
  getMostRecentModel(): string | null;
  getCostSince(sinceMs: number, workspace?: string, source?: TurnSource): { costUsd: number; credits: number; turns: number };
  getCostBySourceSince(sinceMs: number, workspace?: string): SourceCost[];
  countCliSessionsWithoutUsage(sinceMs: number): number;
  getWorkspaces(): string[];
  getInsightMetrics(days?: number, source?: TurnSource): InsightMetrics;
  getAlertMetrics(sinceMs: number, thresholds?: Partial<AlertThresholdConfig>): AlertMetrics;
  getCacheSavingsMetrics(
    sinceMs: number,
    workspace?: string,
    calculateSavingsCost?: (modelFamily: string, writeTokens: number, readTokens: number) => number,
    source?: TurnSource,
  ): CacheSavingsMetrics;
  getMostRecentSessionContext(sinceMs: number, workspace?: string): SessionContextInfo | null;
  getSessionContextTimeline(sessionId: string): ContextTimelinePoint[];
  getSessionContextDistribution(sinceMs: number): SessionContextDistribution[];
}

/** Write access for ingestion and session management. */
export interface CostWriter {
  /** Inserts or upgrades a turn; returns false when an identical turn was already stored. */
  insertTurn(turn: ParsedTurn, costUsd: number, credits: number, workspace: string): boolean;
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

/** Ingestion state and writes for Copilot CLI session logs. */
export interface CliStore {
  getCliSourceStates(): Map<string, CliSourceState>;
  /**
   * Replaces all CLI rows of one session in a single transaction and records its fingerprint.
   * Leaves the rows untouched when the stored usage already matches. Returns true when the
   * session's usage or status changed.
   */
  replaceCliSession(state: CliSourceState, session: CliSessionInfo | null, rows: CostedTurn[]): boolean;
  /** Records a fingerprint without touching the session's rows. */
  markCliSource(state: CliSourceState): void;
  hasChatTurns(sessionId: string): boolean;
  /** Removes CLI rows for sessions that Copilot Chat already recorded; returns their ids. */
  deleteCliTurnsShadowedByChat(): string[];
}

// ── Data types ────────────────────────────────────────

/**
 * - ok: usage rows stored
 * - partial: usage stored, but later activity has no usage data on disk
 * - no_usage: the session made model calls but wrote no usage data
 * - empty: no model calls
 * - shadowed: Copilot Chat already recorded this session
 * - error: the log could not be read
 */
export type CliSourceStatus = "ok" | "partial" | "no_usage" | "empty" | "shadowed" | "error";

export interface CliSourceState {
  sessionId: string;
  filePath: string;
  size: number;
  mtimeMs: number;
  status: CliSourceStatus;
  lastEventMs: number;
}

export interface CliSessionInfo {
  workspace: string;
  startTimestamp: number;
  lastTimestamp: number;
  copilotVersion: string | null;
  title: string | null;
}

export interface CostedTurn {
  turn: ParsedTurn;
  costUsd: number;
  credits: number;
  workspace: string;
}

export interface SourceCost {
  source: TurnSource;
  costUsd: number;
  credits: number;
  turns: number;
}

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
  source: TurnSource;
  requestCount: number;
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
  source: TurnSource;
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
  workspace: string;
  turnCount: number;
  lastActivityMs: number;
  firstActivityMs: number;
  currentContextWeight: number;
  costUsd: number;
  credits: number;
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
