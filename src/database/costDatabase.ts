import * as path from "node:path";
import * as fs from "node:fs";
import initSqlJs, { Database } from "sql.js";
import { ParsedTurn } from "../parser/types";
import { createTables } from "./schema";
import * as queries from "./queries";
import * as metrics from "./metrics";
import type {
  StoredTurn,
  SessionSummary,
  SessionModelBreakdownRow,
  AggregatedCost,
  ModelBreakdown,
  AgentBreakdown,
  DailyAgentBreakdown,
  CacheSavingsMetrics,
  ModelLatencySample,
  InsightMetrics,
  AlertMetrics,
  AlertThresholdConfig,
  SessionContextInfo,
  ContextTimelinePoint,
  SessionContextDistribution,
} from "./types";

export type {
  StoredTurn,
  SessionSummary,
  SessionModelBreakdownRow,
  AggregatedCost,
  ModelBreakdown,
  AgentBreakdown,
  DailyAgentBreakdown,
  CacheSavingsMetrics,
  ModelLatencySample,
  InsightMetrics,
  AlertMetrics,
  AlertThresholdConfig,
  SessionContextInfo,
  ContextTimelinePoint,
  SessionContextDistribution,
};

let wasmPath: string | undefined;
export function setWasmPath(p: string): void {
  wasmPath = p;
}

export class CostDatabase {
  private db: Database | null = null;
  private readonly dbPath: string;
  private saving: boolean = false;
  private wasCorrupted: boolean = false;

  constructor(storagePath: string) {
    this.dbPath = path.join(storagePath, "copilot-costs.db");
  }

  async initialize(): Promise<void> {
    const SQL = await initSqlJs({
      locateFile: () => wasmPath ?? path.join(__dirname, "sql-wasm.wasm"),
    });

    let data: Buffer | undefined;
    try {
      const fs = await import("node:fs");
      if (fs.existsSync(this.dbPath)) {
        data = fs.readFileSync(this.dbPath);
      }
    } catch {
      // Start fresh
    }

    try {
      this.db = data ? new SQL.Database(data) : new SQL.Database();
    } catch (err) {
      console.warn(`[CostDatabase] Corrupted database file (${this.dbPath}), starting fresh. Error: ${err}`);
      this.db = new SQL.Database();
      this.wasCorrupted = true;
    }

    try {
      createTables(this.db);
    } catch (err) {
      console.warn(`[CostDatabase] Failed to create tables, resetting database. Error: ${err}`);
      this.db.close();
      this.db = new SQL.Database();
      this.wasCorrupted = true;
      createTables(this.db);
    }
  }

  /** Returns true if the database was corrupted and had to be reset during initialization. */
  get didRecoverFromCorruption(): boolean {
    return this.wasCorrupted;
  }

  private requireDb(): Database {
    if (!this.db) throw new Error("Database not initialized");
    return this.db;
  }

  beginTransaction(): void {
    if (!this.db) return;
    this.db.run("BEGIN TRANSACTION");
  }

  commitTransaction(): void {
    if (!this.db) return;
    this.db.run("COMMIT");
  }

  rollbackTransaction(): void {
    if (!this.db) return;
    try {
      this.db.run("ROLLBACK");
    } catch {
      // Ignore if no transaction is active
    }
  }

  // ── CRUD ────────────────────────────────────────────

  isSessionProcessed(sessionId: string): boolean {
    if (!this.db) return false;
    return queries.isSessionProcessed(this.db, sessionId);
  }

  getSessionLastTimestamp(sessionId: string): number | null {
    if (!this.db) return null;
    return queries.getSessionLastTimestamp(this.db, sessionId);
  }

  getMaxTimestamp(): number {
    if (!this.db) return 0;
    return queries.getMaxTimestamp(this.db);
  }

  private nullDbWarned = false;

  insertTurn(turn: ParsedTurn, costUsd: number, credits: number, workspace: string): void {
    if (!this.db) {
      if (!this.nullDbWarned) {
        this.nullDbWarned = true;
        console.warn("[CostDatabase] insertTurn called before database initialized — data is being dropped");
      }
      return;
    }
    this.db.run(
      `INSERT OR IGNORE INTO turns
        (session_id, timestamp, duration, agent_name, model, model_family, input_tokens, output_tokens, cached_tokens, cache_write_tokens, total_tokens, cost_usd, credits, workspace, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        turn.sessionId,
        turn.timestamp,
        turn.duration,
        turn.agentName ?? "unknown",
        turn.model,
        turn.modelFamily,
        turn.inputTokens,
        turn.outputTokens,
        turn.cachedTokens,
        turn.cacheWriteTokens,
        turn.totalTokens,
        costUsd,
        credits,
        workspace,
        turn.status,
      ]
    );
  }

  markSessionProcessed(
    sessionId: string,
    workspace: string,
    startTimestamp: number,
    lastTimestamp: number,
    copilotVersion: string,
    vscodeVersion: string
  ): void {
    if (!this.db) return;
    this.db.run(
      `INSERT OR REPLACE INTO sessions
        (session_id, workspace, start_timestamp, last_timestamp, copilot_version, vscode_version, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, workspace, startTimestamp, lastTimestamp, copilotVersion, vscodeVersion, Date.now()]
    );
  }

  // ── Sessions ────────────────────────────────────────

  getSessionSummaries(workspace?: string, limit: number = 50): SessionSummary[] {
    if (!this.db) return [];
    return queries.getSessionSummaries(this.db, workspace, limit);
  }

  getSessionModelBreakdowns(sessionIds: string[]): SessionModelBreakdownRow[] {
    if (!this.db) return [];
    return queries.getSessionModelBreakdowns(this.db, sessionIds);
  }

  getTurnsForSession(sessionId: string, limit: number = 50): StoredTurn[] {
    if (!this.db) return [];
    return queries.getTurnsForSession(this.db, sessionId, limit);
  }

  // ── Aggregations ────────────────────────────────────

  getModelLatencySamples(days: number = 30, workspace?: string): ModelLatencySample[] {
    if (!this.db) return [];
    return queries.getModelLatencySamples(this.db, days, workspace);
  }

  getDailyCosts(days: number = 30, workspace?: string): AggregatedCost[] {
    if (!this.db) return [];
    return queries.getDailyCosts(this.db, days, workspace);
  }

  getDailyCostsSince(sinceMs: number, workspace?: string): AggregatedCost[] {
    if (!this.db) return [];
    return queries.getDailyCostsSince(this.db, sinceMs, workspace);
  }

  getModelBreakdown(days: number = 30, workspace?: string): ModelBreakdown[] {
    if (!this.db) return [];
    return queries.getModelBreakdown(this.db, days, workspace);
  }

  getModelBreakdownSince(sinceMs: number, workspace?: string): ModelBreakdown[] {
    if (!this.db) return [];
    return queries.getModelBreakdownSince(this.db, sinceMs, workspace);
  }

  getAgentBreakdown(days: number = 30, workspace?: string): AgentBreakdown[] {
    if (!this.db) return [];
    return queries.getAgentBreakdown(this.db, days, workspace);
  }

  getAgentBreakdownSince(sinceMs: number, workspace?: string): AgentBreakdown[] {
    if (!this.db) return [];
    return queries.getAgentBreakdownSince(this.db, sinceMs, workspace);
  }

  getDailyAgentBreakdown(days: number = 365, workspace?: string): DailyAgentBreakdown[] {
    if (!this.db) return [];
    return queries.getDailyAgentBreakdown(this.db, days, workspace);
  }

  getCurrentMonthTotal(workspace?: string): { costUsd: number; credits: number; turns: number } {
    if (!this.db) return { costUsd: 0, credits: 0, turns: 0 };
    return queries.getCurrentMonthTotal(this.db, workspace);
  }

  getCreditsSince(sinceMs: number): number {
    if (!this.db) return 0;
    return queries.getCreditsSince(this.db, sinceMs);
  }

  getMostRecentModel(): string | null {
    if (!this.db) return null;
    return queries.getMostRecentModel(this.db);
  }

  getCostSince(sinceMs: number, workspace?: string): { costUsd: number; credits: number; turns: number } {
    if (!this.db) return { costUsd: 0, credits: 0, turns: 0 };
    return queries.getCostSince(this.db, sinceMs, workspace);
  }

  getWorkspaces(): string[] {
    if (!this.db) return [];
    return queries.getWorkspaces(this.db);
  }

  // ── Metrics ─────────────────────────────────────────

  getInsightMetrics(days: number = 30): InsightMetrics {
    if (!this.db) {
      return { totalInputTokens: 0, totalOutputTokens: 0, totalCachedTokens: 0, errorTurns: 0, totalTurns: 0, cacheHitPct: 0, ioRatioDays: [] };
    }
    return metrics.getInsightMetrics(this.db, days);
  }

  getAlertMetrics(sinceMs: number, thresholds?: Partial<AlertThresholdConfig>): AlertMetrics {
    if (!this.db) {
      return {
        avgOutputTokensToday: 0,
        turnsToday: 0,
        maxSessionInputTokens: 0,
        maxIdleGapMs: 0,
        microTurnCount: 0,
        microTurnAvgOutput: 0,
        rawPasteMaxNetInput: 0,
        premiumMisallocationCount: 0,
        premiumMisallocationAvgCredits: 0,
        massiveContextMaxInput: 0,
      };
    }
    return metrics.getAlertMetrics(this.db, sinceMs, thresholds);
  }

  getCacheSavingsMetrics(
    sinceMs: number,
    workspace?: string,
    calculateSavingsCost?: (modelFamily: string, writeTokens: number, readTokens: number) => number,
  ): CacheSavingsMetrics {
    if (!this.db) {
      return {
        totalCacheWriteTokens: 0,
        totalCacheReadTokens: 0,
        totalSavingsCostUsd: 0,
        totalSavingsCredits: 0,
        byModel: [],
      };
    }
    return metrics.getCacheSavingsMetrics(this.db, sinceMs, workspace, calculateSavingsCost);
  }

  // ── Context Awareness ───────────────────────────────

  getMostRecentSessionContext(sinceMs: number): SessionContextInfo | null {
    if (!this.db) return null;
    return queries.getMostRecentSessionContext(this.db, sinceMs);
  }

  getSessionContextTimeline(sessionId: string): ContextTimelinePoint[] {
    if (!this.db) return [];
    return queries.getSessionContextTimeline(this.db, sessionId);
  }

  getSessionContextDistribution(sinceMs: number): SessionContextDistribution[] {
    if (!this.db) return [];
    return queries.getSessionContextDistribution(this.db, sinceMs);
  }

  // ── Maintenance ─────────────────────────────────────

  async save(): Promise<void> {
    if (!this.db) return;
    if (this.saving) return;
    this.saving = true;
    try {
      const dir = path.dirname(this.dbPath);
      await fs.promises.mkdir(dir, { recursive: true });
      const data = this.db.export();
      const tmpPath = this.dbPath + ".tmp";
      await fs.promises.writeFile(tmpPath, Buffer.from(data));
      await fs.promises.rename(tmpPath, this.dbPath);
    } catch (err) {
      console.error(`[CostDatabase] Failed to save database: ${err}`);
    } finally {
      this.saving = false;
    }
  }

  pruneOldTurns(retentionDays: number): number {
    if (!this.db) return 0;

    const safeDays = Math.max(1, Math.min(3650, retentionDays));
    const cutoffMs = Date.now() - safeDays * 24 * 60 * 60 * 1000;

    const beforeStmt = this.db.prepare(`SELECT COUNT(*) FROM turns WHERE timestamp < :cutoff`);
    beforeStmt.bind({ ":cutoff": cutoffMs });
    const countBefore = beforeStmt.step() ? (beforeStmt.get()[0] as number) : 0;
    beforeStmt.free();

    this.db.run(
      `DELETE FROM turns
       WHERE timestamp < ?
         AND rowid NOT IN (
           SELECT rowid FROM (
             SELECT rowid, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY timestamp DESC) AS rn
             FROM turns
           ) WHERE rn = 1
         )`,
      [cutoffMs]
    );

    const afterStmt = this.db.prepare(`SELECT COUNT(*) FROM turns WHERE timestamp < :cutoff`);
    afterStmt.bind({ ":cutoff": cutoffMs });
    const countAfter = afterStmt.step() ? (afterStmt.get()[0] as number) : 0;
    afterStmt.free();

    return Math.max(0, countBefore - countAfter);
  }

  close(): void {
    if (this.db) {
      // Synchronous save on close to ensure data is persisted before process exit
      if (!this.saving) {
        try {
          const dir = path.dirname(this.dbPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          const data = this.db.export();
          const tmpPath = this.dbPath + ".tmp";
          fs.writeFileSync(tmpPath, Buffer.from(data));
          fs.renameSync(tmpPath, this.dbPath);
        } catch (err) {
          console.error(`[CostDatabase] Failed to save database on close: ${err}`);
        }
      }
      this.db.close();
      this.db = null;
    }
  }
}
