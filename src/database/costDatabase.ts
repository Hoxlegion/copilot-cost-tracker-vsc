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
};

let wasmPath: string | undefined;
export function setWasmPath(p: string): void {
  wasmPath = p;
}

export class CostDatabase {
  private db: Database | null = null;
  private readonly dbPath: string;

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
    }
    createTables(this.db);
  }

  private requireDb(): Database {
    if (!this.db) throw new Error("Database not initialized");
    return this.db;
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

  insertTurn(turn: ParsedTurn, costUsd: number, credits: number, workspace: string): void {
    if (!this.db) return;
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

  getCacheSavingsMetrics(sinceMs: number, workspace?: string): CacheSavingsMetrics {
    if (!this.db) {
      return {
        totalCacheWriteTokens: 0,
        totalCacheReadTokens: 0,
        totalSavingsCostUsd: 0,
        totalSavingsCredits: 0,
        byModel: [],
      };
    }
    return metrics.getCacheSavingsMetrics(this.db, sinceMs, workspace);
  }

  // ── Maintenance ─────────────────────────────────────

  save(): void {
    if (!this.db) return;
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  pruneOldTurns(retentionDays: number): number {
    if (!this.db) return 0;

    const safeDays = Math.max(1, Math.min(3650, retentionDays));
    const cutoffMs = Date.now() - safeDays * 24 * 60 * 60 * 1000;

    const beforeResult = this.db.exec(`SELECT COUNT(*) as count FROM turns WHERE timestamp < ${cutoffMs}`);
    const countBefore = beforeResult.length > 0 ? (beforeResult[0].values[0][0] as number) : 0;

    this.db.run(
      `DELETE FROM turns
       WHERE timestamp < ?
         AND (session_id, timestamp) NOT IN (
           SELECT session_id, MAX(timestamp)
           FROM turns
           GROUP BY session_id
         )`,
      [cutoffMs]
    );

    const afterResult = this.db.exec(`SELECT COUNT(*) as count FROM turns WHERE timestamp < ${cutoffMs}`);
    const countAfter = afterResult.length > 0 ? (afterResult[0].values[0][0] as number) : 0;
    return Math.max(0, countBefore - countAfter);
  }

  close(): void {
    this.save();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
