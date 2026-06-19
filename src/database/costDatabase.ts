import * as path from "node:path";
import * as fs from "node:fs";
import initSqlJs, { Database } from "sql.js";
import { ParsedTurn } from "../parser/types";
import { createTables } from "./schema";
import * as queries from "./queries";
import * as metrics from "./metrics";
import type {
  CostReader,
  CostWriter,
  CostMaintenance,
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
  CostReader,
  CostWriter,
  CostMaintenance,
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

export class CostDatabase implements CostReader, CostWriter, CostMaintenance {
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
      this.runMigrations(this.db);
    } catch (err) {
      console.warn(`[CostDatabase] Failed to create tables, resetting database. Error: ${err}`);
      this.db.close();
      this.db = new SQL.Database();
      this.wasCorrupted = true;
      createTables(this.db);
      this.runMigrations(this.db);
    }
  }

  private runMigrations(db: Database): void {
    try {
      this.mergeDuplicateSessionRecords(db);
    } catch (err) {
      console.warn(`[CostDatabase] Migration error (non-fatal), continuing: ${err}`);
    }
  }

  runLegacySessionDedupMigration(): void {
    if (!this.db) return;
    try {
      this.mergeDuplicateSessionRecords(this.db);
    } catch (err) {
      console.warn(`[CostDatabase] Legacy session dedupe failed (non-fatal): ${err}`);
    }
  }

  private mergeDuplicateSessionRecords(db: Database): void {
    // Check if migration already ran (marker stored as a pragmatic session record)
    const marker = db.exec("SELECT 1 FROM sessions WHERE session_id = '__migration_merge_v2__'");
    if (marker.length > 0 && marker[0].values.length > 0) return;

    // Defer marking completion until title sync has happened at least once.
    // Otherwise we may mark as done too early and miss legacy duplicates.
    const titledCountStmt = db.prepare(
      "SELECT COUNT(*) as c FROM sessions WHERE title IS NOT NULL AND TRIM(title) != ''"
    );
    let titledCount = 0;
    if (titledCountStmt.step()) {
      const row = titledCountStmt.getAsObject();
      titledCount = Number(row.c ?? 0);
    }
    titledCountStmt.free();
    if (titledCount === 0) return;

    // Find sessions with the same title in the same workspace, created within 1 hour of each other
    // This cleans up duplicates from the title mapping bug that mapped to both parent and conversation IDs
    const stmt = db.prepare(`
      SELECT 
        s1.session_id as primary_id,
        s2.session_id as duplicate_id,
        s1.title
      FROM sessions s1
      JOIN sessions s2 ON 
        s1.workspace = s2.workspace 
        AND s1.title IS NOT NULL 
        AND s1.title = s2.title 
        AND s1.session_id < s2.session_id
        AND ABS(s1.start_timestamp - s2.start_timestamp) < 3600000
    `);

    const duplicates: Array<{ primary_id: string; duplicate_id: string; title: string }> = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      duplicates.push({
        primary_id: row.primary_id as string,
        duplicate_id: row.duplicate_id as string,
        title: row.title as string,
      });
    }
    stmt.free();

    if (duplicates.length > 0) {
      console.info(`[CostDatabase] Found ${duplicates.length} duplicate session pair(s) to merge`);

      for (const dup of duplicates) {
        // Move turns that won't violate the UNIQUE(session_id, timestamp, model) constraint
        db.run(
          `UPDATE turns SET session_id = ?
           WHERE session_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM turns t2
               WHERE t2.session_id = ?
                 AND t2.timestamp = turns.timestamp
                 AND t2.model = turns.model
             )`,
          [dup.primary_id, dup.duplicate_id, dup.primary_id]
        );

        // Delete any remaining duplicate turns that couldn't be moved (they already exist on the primary)
        db.run(`DELETE FROM turns WHERE session_id = ?`, [dup.duplicate_id]);

        // Update primary session's last_timestamp
        const tsStmt = db.prepare(`SELECT MAX(timestamp) as max_ts FROM turns WHERE session_id = ?`);
        tsStmt.bind([dup.primary_id]);
        let newLastTs: number | undefined;
        if (tsStmt.step()) {
          const row = tsStmt.getAsObject();
          newLastTs = row.max_ts as number | undefined;
        }
        tsStmt.free();

        if (newLastTs !== undefined && newLastTs > 0) {
          db.run(`UPDATE sessions SET last_timestamp = ? WHERE session_id = ?`, [newLastTs, dup.primary_id]);
        }

        // Delete the duplicate session record
        db.run(`DELETE FROM sessions WHERE session_id = ?`, [dup.duplicate_id]);

        console.info(`[CostDatabase] Merged duplicate session "${dup.title}" (${dup.duplicate_id} → ${dup.primary_id})`);
      }
    }

    // Mark migration as done so it doesn't re-run
    db.run(
      `INSERT OR IGNORE INTO sessions (session_id, workspace, start_timestamp, last_timestamp, processed_at) VALUES ('__migration_merge_v2__', '', 0, 0, ?)`,
      [Date.now()]
    );
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
      `INSERT INTO turns
        (session_id, timestamp, duration, agent_name, model, model_family, input_tokens, output_tokens, cached_tokens, cache_write_tokens, total_tokens, cost_usd, credits, workspace, status, cost_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, timestamp, model) DO UPDATE SET
         cost_usd = excluded.cost_usd,
         credits = excluded.credits,
         cost_source = excluded.cost_source
       WHERE excluded.cost_source = 'real' AND cost_source != 'real'`,
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
        turn.costSource ?? "estimated",
      ]
    );
  }

  markSessionProcessed(
    sessionId: string,
    workspace: string,
    startTimestamp: number,
    lastTimestamp: number,
    copilotVersion: string,
    vscodeVersion: string,
    title?: string
  ): void {
    if (!this.db) return;
    this.db.run(
      `INSERT OR REPLACE INTO sessions
        (session_id, workspace, start_timestamp, last_timestamp, copilot_version, vscode_version, processed_at, title)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, workspace, startTimestamp, lastTimestamp, copilotVersion, vscodeVersion, Date.now(), title ?? null]
    );
  }

  updateSessionTitles(titles: Map<string, string>): void {
    if (!this.db || titles.size === 0) return;

    // Guard for legacy databases that may not have run schema migration yet.
    const titleColCheck = this.db.exec("PRAGMA table_info(sessions)");
    if (titleColCheck.length > 0) {
      const hasTitle = titleColCheck[0].values.some((row) => row[1] === "title");
      if (!hasTitle) {
        this.db.run("ALTER TABLE sessions ADD COLUMN title TEXT");
      }
    }

    // In traces-DB mode we may have turns without a matching sessions row.
    // Create minimal session records so title updates can attach correctly.
    const ensureSessionStmt = this.db.prepare(
      `INSERT OR IGNORE INTO sessions
        (session_id, workspace, start_timestamp, last_timestamp, copilot_version, vscode_version, processed_at, title)
       SELECT
         t.session_id,
         MIN(t.workspace),
         MIN(t.timestamp),
         MAX(t.timestamp),
         NULL,
         NULL,
         ?,
         NULL
       FROM turns t
       WHERE t.session_id = ?
       GROUP BY t.session_id`
    );

    const stmt = this.db.prepare(
      `UPDATE sessions SET title = :title WHERE session_id = :id AND (title IS NULL OR title != :title)`
    );
    for (const [sessionId, title] of titles) {
      ensureSessionStmt.bind([Date.now(), sessionId]);
      ensureSessionStmt.step();
      ensureSessionStmt.reset();

      stmt.bind({ ":title": title, ":id": sessionId });
      stmt.step();
      stmt.reset();
    }
    ensureSessionStmt.free();
    stmt.free();
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
