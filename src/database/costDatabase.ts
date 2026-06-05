import * as path from "node:path";
import initSqlJs, { Database } from "sql.js";
import { ParsedTurn } from "../parser/types";

// Path to the WASM file bundled with the extension
let wasmPath: string | undefined;
export function setWasmPath(p: string): void {
  wasmPath = p;
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
  period: string; // ISO date or "YYYY-WW" or "YYYY-MM"
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

interface AlertThresholdConfig {
  microTurnGapMs: number;
  microTurnMinCount: number;
  microTurnMaxOutputTokens: number;
  rawPasteMinInputTokens: number;
  premiumMisallocationMinCredits: number;
  premiumMisallocationMaxOutputTokens: number;
  agentSprawlMinInputTokens: number;
}

interface AlertMetricAccumulator {
  microTurnCount: number;
  microTurnOutputTotal: number;
  rawPasteMaxNetInput: number;
  premiumMisallocationCount: number;
  premiumMisallocationCreditsTotal: number;
  massiveContextMaxInput: number;
  previousSessionId: string | null;
  previousTimestamp: number;
}

export class CostDatabase {
  private db: Database | null = null;
  private readonly dbPath: string;

  private clampInt(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.min(max, Math.max(min, Math.floor(value)));
  }

  private getAlertThresholdConfig(thresholds?: Partial<AlertThresholdConfig>): AlertThresholdConfig {
    return {
      microTurnGapMs: thresholds?.microTurnGapMs ?? 120_000,
      microTurnMinCount: thresholds?.microTurnMinCount ?? 5,
      microTurnMaxOutputTokens: thresholds?.microTurnMaxOutputTokens ?? 200,
      rawPasteMinInputTokens: thresholds?.rawPasteMinInputTokens ?? 15_000,
      premiumMisallocationMinCredits: thresholds?.premiumMisallocationMinCredits ?? 2,
      premiumMisallocationMaxOutputTokens: thresholds?.premiumMisallocationMaxOutputTokens ?? 100,
      agentSprawlMinInputTokens: thresholds?.agentSprawlMinInputTokens ?? 80_000,
    };
  }

  private getVerbosityMetrics(sinceMs: number): { avgOutputTokensToday: number; turnsToday: number } {
    if (!this.db) {
      return { avgOutputTokensToday: 0, turnsToday: 0 };
    }

    const verbosityResult = this.db.exec(`
      SELECT AVG(CAST(output_tokens AS REAL)), COUNT(*)
      FROM turns WHERE timestamp >= ${sinceMs} AND output_tokens > 0
    `);

    if (verbosityResult.length === 0 || verbosityResult[0].values.length === 0) {
      return { avgOutputTokensToday: 0, turnsToday: 0 };
    }

    const row = verbosityResult[0].values[0];
    return {
      avgOutputTokensToday: (row[0] as number) || 0,
      turnsToday: (row[1] as number) || 0,
    };
  }

  private getMaxSessionInputTokensSince(sinceMs: number): number {
    if (!this.db) {
      return 0;
    }

    const bloatResult = this.db.exec(`
      SELECT MAX(session_total) FROM (
        SELECT session_id, SUM(input_tokens + cached_tokens) AS session_total
        FROM turns WHERE timestamp >= ${sinceMs}
        GROUP BY session_id
      )
    `);

    if (bloatResult.length === 0 || bloatResult[0].values.length === 0) {
      return 0;
    }

    return (bloatResult[0].values[0][0] as number) || 0;
  }

  private getMaxIdleGapMsSince(sinceMs: number): number {
    if (!this.db) {
      return 0;
    }

    const gapResult = this.db.exec(`
      SELECT MAX(gap_ms) FROM (
        SELECT
          t1.session_id,
          (
            SELECT MIN(t2.timestamp) FROM turns t2
            WHERE t2.session_id = t1.session_id AND t2.timestamp > t1.timestamp
          ) - t1.timestamp AS gap_ms
        FROM turns t1
        WHERE t1.timestamp >= ${sinceMs}
      )
      WHERE gap_ms IS NOT NULL
    `);

    if (gapResult.length === 0 || gapResult[0].values.length === 0) {
      return 0;
    }

    return (gapResult[0].values[0][0] as number) || 0;
  }

  private getThresholdAlertMetrics(
    sinceMs: number,
    cfg: AlertThresholdConfig
  ): {
    microTurnCount: number;
    microTurnAvgOutput: number;
    rawPasteMaxNetInput: number;
    premiumMisallocationCount: number;
    premiumMisallocationAvgCredits: number;
    massiveContextMaxInput: number;
  } {
    if (!this.db) {
      return {
        microTurnCount: 0,
        microTurnAvgOutput: 0,
        rawPasteMaxNetInput: 0,
        premiumMisallocationCount: 0,
        premiumMisallocationAvgCredits: 0,
        massiveContextMaxInput: 0,
      };
    }

    const rowsResult = this.db.exec(`
      SELECT session_id, timestamp, input_tokens, output_tokens, cached_tokens, credits
      FROM turns WHERE timestamp >= ${sinceMs}
      ORDER BY session_id ASC, timestamp ASC
    `);

    const acc: AlertMetricAccumulator = {
      microTurnCount: 0,
      microTurnOutputTotal: 0,
      rawPasteMaxNetInput: 0,
      premiumMisallocationCount: 0,
      premiumMisallocationCreditsTotal: 0,
      massiveContextMaxInput: 0,
      previousSessionId: null,
      previousTimestamp: 0,
    };

    if (rowsResult.length > 0) {
      for (const row of rowsResult[0].values) {
        this.applyAlertMetricRow(acc, row, cfg);
      }
    }

    if (acc.microTurnCount < cfg.microTurnMinCount) {
      acc.microTurnCount = 0;
      acc.microTurnOutputTotal = 0;
    }

    const microTurnAvgOutput = acc.microTurnCount > 0
      ? Math.round(acc.microTurnOutputTotal / acc.microTurnCount)
      : 0;

    const premiumMisallocationAvgCredits = acc.premiumMisallocationCount > 0
      ? acc.premiumMisallocationCreditsTotal / acc.premiumMisallocationCount
      : 0;

    return {
      microTurnCount: acc.microTurnCount,
      microTurnAvgOutput,
      rawPasteMaxNetInput: acc.rawPasteMaxNetInput,
      premiumMisallocationCount: acc.premiumMisallocationCount,
      premiumMisallocationAvgCredits,
      massiveContextMaxInput: acc.massiveContextMaxInput,
    };
  }

  private applyAlertMetricRow(
    acc: AlertMetricAccumulator,
    row: unknown[],
    cfg: AlertThresholdConfig
  ): void {
    const sessionId = (row[0] as string) ?? "";
    const timestamp = (row[1] as number) || 0;
    const inputTokens = (row[2] as number) || 0;
    const outputTokens = (row[3] as number) || 0;
    const cachedTokens = (row[4] as number) || 0;
    const credits = (row[5] as number) || 0;

    const totalInput = inputTokens + cachedTokens;
    if (totalInput > acc.massiveContextMaxInput) {
      acc.massiveContextMaxInput = totalInput;
    }

    const netInput = Math.max(0, inputTokens - cachedTokens);
    if (netInput >= cfg.rawPasteMinInputTokens && netInput > acc.rawPasteMaxNetInput) {
      acc.rawPasteMaxNetInput = netInput;
    }

    if (credits >= cfg.premiumMisallocationMinCredits && outputTokens <= cfg.premiumMisallocationMaxOutputTokens) {
      acc.premiumMisallocationCount++;
      acc.premiumMisallocationCreditsTotal += credits;
    }

    if (acc.previousSessionId === sessionId) {
      const gap = timestamp - acc.previousTimestamp;
      if (gap >= 0 && gap <= cfg.microTurnGapMs && outputTokens <= cfg.microTurnMaxOutputTokens) {
        acc.microTurnCount++;
        acc.microTurnOutputTotal += outputTokens;
      }
    }

    acc.previousSessionId = sessionId;
    acc.previousTimestamp = timestamp;
  }

  constructor(storagePath: string) {
    this.dbPath = path.join(storagePath, "copilot-costs.db");
  }

  async initialize(): Promise<void> {
    const SQL = await initSqlJs({
      locateFile: () => wasmPath ?? path.join(__dirname, "sql-wasm.wasm"),
    });

    // Try to load existing database
    let data: Buffer | undefined;
    try {
      const fs = await import("node:fs");
      if (fs.existsSync(this.dbPath)) {
        data = fs.readFileSync(this.dbPath);
      }
    } catch {
      // Start fresh
    }

    // Attempt to load existing DB; gracefully recover from corruption
    try {
      this.db = data ? new SQL.Database(data) : new SQL.Database();
    } catch (err) {
      console.warn(`[CostDatabase] Corrupted database file (${this.dbPath}), starting fresh. Error: ${err}`);
      // Log the error but continue with a fresh database
      this.db = new SQL.Database();
    }
    this.createTables();
  }

  private createTables(): void {
    if (!this.db) {return;}

    // Deduplication key (D3): unique constraint on (session_id, timestamp, model) prevents duplicate inserts
    // even if watermark recovery logic has edge cases (e.g., clock skew).
    this.db.run(`
      CREATE TABLE IF NOT EXISTS turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        duration INTEGER NOT NULL,
        agent_name TEXT NOT NULL DEFAULT 'unknown',
        model TEXT NOT NULL,
        model_family TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cached_tokens INTEGER NOT NULL,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        credits REAL NOT NULL,
        workspace TEXT NOT NULL,
        status TEXT NOT NULL,
        UNIQUE(session_id, timestamp, model)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        workspace TEXT NOT NULL,
        start_timestamp INTEGER NOT NULL,
        last_timestamp INTEGER NOT NULL,
        copilot_version TEXT,
        vscode_version TEXT,
        processed_at INTEGER NOT NULL
      )
    `);

    // Ensure older databases are upgraded before indexes/queries reference new columns.
    this.ensureTurnsSchema();

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id)
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp)
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_turns_workspace ON turns(workspace)
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_turns_model ON turns(model_family)
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_turns_agent ON turns(agent_name)
    `);
  }

  /**
   * Add missing columns for databases created by older extension versions.
   */
  private ensureTurnsSchema(): void {
    if (!this.db) {return;}

    const existingColumns = this.getTurnsColumnNames();
    this.addTurnsColumnIfMissing(existingColumns, "agent_name", "TEXT NOT NULL DEFAULT 'unknown'");
    this.addTurnsColumnIfMissing(existingColumns, "cache_write_tokens", "INTEGER NOT NULL DEFAULT 0");
    this.addTurnsColumnIfMissing(existingColumns, "model_family", "TEXT NOT NULL DEFAULT 'unknown'");
  }

  private getTurnsColumnNames(): Set<string> {
    const names = new Set<string>();
    if (!this.db) {return names;}

    const result = this.db.exec("PRAGMA table_info(turns)");
    if (result.length === 0) {return names;}

    for (const row of result[0].values) {
      const columnName = row[1];
      if (typeof columnName === "string") {
        names.add(columnName);
      }
    }

    return names;
  }

  private addTurnsColumnIfMissing(existingColumns: Set<string>, column: string, definition: string): void {
    if (!this.db || existingColumns.has(column)) {return;}
    this.db.run(`ALTER TABLE turns ADD COLUMN ${column} ${definition}`);
    existingColumns.add(column);
  }

  /**
   * Check if a session has already been processed.
   */
  isSessionProcessed(sessionId: string): boolean {
    if (!this.db) {return false;}

    const stmt = this.db.prepare("SELECT 1 FROM sessions WHERE session_id = :sessionId LIMIT 1");
    stmt.bind({ ":sessionId": sessionId });
    const found = stmt.step();
    stmt.free();
    return found;
  }

  /**
   * Return the last processed timestamp for a session, if known.
   */
  getSessionLastTimestamp(sessionId: string): number | null {
    if (!this.db) { return null; }

    const stmt = this.db.prepare("SELECT last_timestamp FROM sessions WHERE session_id = :sessionId LIMIT 1");
    stmt.bind({ ":sessionId": sessionId });

    let lastTimestamp: number | null = null;
    if (stmt.step()) {
      const row = stmt.getAsObject();
      lastTimestamp = (row.last_timestamp as number) ?? null;
    }

    stmt.free();
    return lastTimestamp;
  }

  /**
   * Get the maximum timestamp from the turns table.
   * Used as the watermark for restart recovery (D3).
   * Returns 0 if no turns exist.
   */
  getMaxTimestamp(): number {
    if (!this.db) {return 0;}

    const result = this.db.exec("SELECT MAX(timestamp) FROM turns");
    if (result.length > 0 && result[0].values.length > 0 && result[0].values[0][0] != null) {
      return result[0].values[0][0] as number;
    }
    return 0;
  }

  /**
   * Insert a turn with its calculated cost.
   */
  insertTurn(turn: ParsedTurn, costUsd: number, credits: number, workspace: string): void {
    if (!this.db) {return;}

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

  /**
   * Mark a session as processed.
   */
  markSessionProcessed(
    sessionId: string,
    workspace: string,
    startTimestamp: number,
    lastTimestamp: number,
    copilotVersion: string,
    vscodeVersion: string
  ): void {
    if (!this.db) {return;}

    this.db.run(
      `INSERT OR REPLACE INTO sessions
        (session_id, workspace, start_timestamp, last_timestamp, copilot_version, vscode_version, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, workspace, startTimestamp, lastTimestamp, copilotVersion, vscodeVersion, Date.now()]
    );
  }

  /**
   * Get session summaries, optionally filtered by workspace.
   */
  getSessionSummaries(workspace?: string, limit: number = 50): SessionSummary[] {
    if (!this.db) {return [];}

    const safeLimit = this.clampInt(limit, 1, 500);
    const stmt = this.db.prepare(`
      SELECT 
        session_id,
        workspace,
        MIN(timestamp) as start_timestamp,
        MAX(timestamp) as last_timestamp,
        COUNT(*) as turn_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(cached_tokens) as total_cached_tokens,
        SUM(cost_usd) as total_cost_usd,
        SUM(credits) as total_credits,
        AVG(duration) as avg_duration_ms,
        (SELECT model_family FROM turns t2 WHERE t2.session_id = turns.session_id GROUP BY model_family ORDER BY COUNT(*) DESC LIMIT 1) as primary_model
      FROM turns
      WHERE (:workspace IS NULL OR workspace = :workspace)
      GROUP BY session_id, workspace
      HAVING total_cost_usd > 0 OR total_input_tokens > 0
      ORDER BY start_timestamp DESC
      LIMIT :limit
    `);
    stmt.bind({
      ":workspace": workspace ?? null,
      ":limit": safeLimit,
    });

    const rows: SessionSummary[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push({
        sessionId: row.session_id as string,
        workspace: row.workspace as string,
        startTimestamp: row.start_timestamp as number,
        lastTimestamp: row.last_timestamp as number,
        turnCount: row.turn_count as number,
        totalInputTokens: row.total_input_tokens as number,
        totalOutputTokens: row.total_output_tokens as number,
        totalCachedTokens: row.total_cached_tokens as number,
        totalCostUsd: row.total_cost_usd as number,
        totalCredits: row.total_credits as number,
        avgDurationMs: row.avg_duration_ms as number,
        primaryModel: row.primary_model as string,
      });
    }
    stmt.free();
    return rows;
  }

  /**
   * Return per-model aggregates for a set of sessions.
   */
  getSessionModelBreakdowns(sessionIds: string[]): SessionModelBreakdownRow[] {
    if (!this.db || sessionIds.length === 0) {
      return [];
    }

    const uniqueSessionIds = Array.from(new Set(sessionIds.filter((id) => id.trim().length > 0)));
    if (uniqueSessionIds.length === 0) {
      return [];
    }

    const rows: SessionModelBreakdownRow[] = [];
    const chunkSize = 300;

    for (let i = 0; i < uniqueSessionIds.length; i += chunkSize) {
      const chunk = uniqueSessionIds.slice(i, i + chunkSize);
      const placeholders = chunk.map((_id, idx) => `:sid${idx}`).join(", ");
      const stmt = this.db.prepare(`
        SELECT
          session_id,
          model_family,
          COUNT(*) as turn_count,
          SUM(input_tokens) as total_input_tokens,
          SUM(output_tokens) as total_output_tokens,
          SUM(cached_tokens) as total_cached_tokens,
          SUM(cost_usd) as total_cost_usd,
          SUM(credits) as total_credits
        FROM turns
        WHERE session_id IN (${placeholders})
        GROUP BY session_id, model_family
        ORDER BY session_id ASC, total_cost_usd DESC
      `);

      const bindings: Record<string, string> = {};
      chunk.forEach((sessionId, idx) => {
        bindings[`:sid${idx}`] = sessionId;
      });
      stmt.bind(bindings);

      while (stmt.step()) {
        const row = stmt.getAsObject();
        rows.push({
          sessionId: row.session_id as string,
          model: row.model_family as string,
          turnCount: row.turn_count as number,
          totalInputTokens: row.total_input_tokens as number,
          totalOutputTokens: row.total_output_tokens as number,
          totalCachedTokens: row.total_cached_tokens as number,
          totalCostUsd: row.total_cost_usd as number,
          totalCredits: row.total_credits as number,
        });
      }

      stmt.free();
    }

    return rows;
  }

  /**
   * Get the latest turns for a given session.
   */
  getTurnsForSession(sessionId: string, limit: number = 50): StoredTurn[] {
    if (!this.db) { return []; }

    const stmt = this.db.prepare(
      `SELECT id, session_id, timestamp, duration, agent_name, model, model_family, input_tokens, output_tokens, cached_tokens, cache_write_tokens, total_tokens, cost_usd, credits, workspace, status
       FROM turns
       WHERE session_id = :sessionId
       ORDER BY timestamp DESC
       LIMIT :limit`
    );
    stmt.bind({ ":sessionId": sessionId, ":limit": limit });

    const rows: StoredTurn[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push({
        id: row.id as number,
        sessionId: row.session_id as string,
        timestamp: row.timestamp as number,
        duration: row.duration as number,
        agentName: row.agent_name as string,
        model: row.model as string,
        modelFamily: row.model_family as string,
        inputTokens: row.input_tokens as number,
        outputTokens: row.output_tokens as number,
        cachedTokens: row.cached_tokens as number,
        cacheWriteTokens: row.cache_write_tokens as number,
        totalTokens: row.total_tokens as number,
        costUsd: row.cost_usd as number,
        credits: row.credits as number,
        workspace: row.workspace as string,
        status: row.status as string,
      });
    }
    stmt.free();
    return rows;
  }

  /**
   * Return per-turn model latency samples for the last N days.
   */
  getModelLatencySamples(days: number = 30, workspace?: string): ModelLatencySample[] {
    if (!this.db) { return []; }

    const safeDays = this.clampInt(days, 1, 3650);
    const since = Date.now() - safeDays * 24 * 60 * 60 * 1000;
    const stmt = this.db.prepare(`
      SELECT model_family, duration
      FROM turns
      WHERE timestamp >= :since
        AND (:workspace IS NULL OR workspace = :workspace)
      ORDER BY model_family, duration
    `);
    stmt.bind({
      ":since": since,
      ":workspace": workspace ?? null,
    });

    const rows: ModelLatencySample[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push({
        model: row.model_family as string,
        duration: row.duration as number,
      });
    }
    stmt.free();
    return rows;
  }

  /**
   * Get cost aggregated by day.
   */
  getDailyCosts(days: number = 30, workspace?: string): AggregatedCost[] {
    if (!this.db) {return [];}

    const safeDays = this.clampInt(days, 1, 3650);
    const since = Date.now() - safeDays * 24 * 60 * 60 * 1000;

    const stmt = this.db.prepare(`
      SELECT 
        date(timestamp / 1000, 'unixepoch') as period,
        SUM(cost_usd) as total_cost_usd,
        SUM(credits) as total_credits,
        COUNT(*) as turn_count
      FROM turns
      WHERE timestamp >= :since
        AND (:workspace IS NULL OR workspace = :workspace)
      GROUP BY period
      ORDER BY period DESC
    `);
    stmt.bind({
      ":since": since,
      ":workspace": workspace ?? null,
    });

    const rows: AggregatedCost[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push({
        period: row.period as string,
        totalCostUsd: row.total_cost_usd as number,
        totalCredits: row.total_credits as number,
        turnCount: row.turn_count as number,
      });
    }
    stmt.free();
    return rows;
  }

  /**
   * Get cost breakdown by model.
   */
  getModelBreakdown(days: number = 30, workspace?: string): ModelBreakdown[] {
    if (!this.db) {return [];}

    const safeDays = this.clampInt(days, 1, 3650);
    const since = Date.now() - safeDays * 24 * 60 * 60 * 1000;

    const stmt = this.db.prepare(`
      SELECT 
        model_family,
        SUM(cost_usd) as total_cost_usd,
        SUM(credits) as total_credits,
        COUNT(*) as turn_count
      FROM turns
      WHERE timestamp >= :since
        AND (:workspace IS NULL OR workspace = :workspace)
      GROUP BY model_family
      ORDER BY total_cost_usd DESC
    `);
    stmt.bind({
      ":since": since,
      ":workspace": workspace ?? null,
    });

    const rows: ModelBreakdown[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push({
        model: row.model_family as string,
        totalCostUsd: row.total_cost_usd as number,
        totalCredits: row.total_credits as number,
        turnCount: row.turn_count as number,
        percentage: 0,
      });
    }
    stmt.free();

    const totalCost = rows.reduce((sum, r) => sum + r.totalCostUsd, 0);
    for (const row of rows) {
      row.percentage = totalCost > 0 ? (row.totalCostUsd / totalCost) * 100 : 0;
    }

    return rows;
  }

  getDailyCostsSince(sinceMs: number, workspace?: string): AggregatedCost[] {
    if (!this.db) { return []; }

    const safeSince = Number.isFinite(sinceMs) ? Math.floor(sinceMs) : 0;
    const stmt = this.db.prepare(`
      SELECT
        date(timestamp / 1000, 'unixepoch') as period,
        SUM(cost_usd) as total_cost_usd,
        SUM(credits) as total_credits,
        COUNT(*) as turn_count
      FROM turns
      WHERE timestamp >= :since
        AND (:workspace IS NULL OR workspace = :workspace)
      GROUP BY period
      ORDER BY period DESC
    `);
    stmt.bind({
      ':since': safeSince,
      ':workspace': workspace ?? null,
    });

    const rows: AggregatedCost[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push({
        period: row.period as string,
        totalCostUsd: row.total_cost_usd as number,
        totalCredits: row.total_credits as number,
        turnCount: row.turn_count as number,
      });
    }
    stmt.free();
    return rows;
  }

  getModelBreakdownSince(sinceMs: number, workspace?: string): ModelBreakdown[] {
    if (!this.db) { return []; }

    const safeSince = Number.isFinite(sinceMs) ? Math.floor(sinceMs) : 0;

    const stmt = this.db.prepare(
      `SELECT model_family, SUM(cost_usd) as total_cost_usd, SUM(credits) as total_credits, COUNT(*) as turn_count
       FROM turns
       WHERE timestamp >= :since
         AND (:workspace IS NULL OR workspace = :workspace)
       GROUP BY model_family
       ORDER BY total_cost_usd DESC`
    );
    stmt.bind({
      ':since': safeSince,
      ':workspace': workspace ?? null,
    });

    const rows: ModelBreakdown[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject();
      rows.push({
        model: r.model_family as string,
        totalCostUsd: r.total_cost_usd as number,
        totalCredits: r.total_credits as number,
        turnCount: r.turn_count as number,
        percentage: 0,
      });
    }
    stmt.free();

    const totalCost = rows.reduce((sum, r) => sum + r.totalCostUsd, 0);
    for (const row of rows) {
      row.percentage = totalCost > 0 ? (row.totalCostUsd / totalCost) * 100 : 0;
    }
    return rows;
  }

  getAgentBreakdown(days: number = 30, workspace?: string): AgentBreakdown[] {
    if (!this.db) { return []; }

    const safeDays = this.clampInt(days, 1, 3650);
    const since = Date.now() - safeDays * 24 * 60 * 60 * 1000;

    const stmt = this.db.prepare(`
      SELECT agent_name, SUM(cost_usd) as total_cost_usd, SUM(credits) as total_credits, COUNT(*) as turn_count
      FROM turns
      WHERE timestamp >= :since
        AND (:workspace IS NULL OR workspace = :workspace)
      GROUP BY agent_name
      ORDER BY total_cost_usd DESC
    `);
    stmt.bind({
      ":since": since,
      ":workspace": workspace ?? null,
    });

    const rows: AgentBreakdown[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push({
        agentName: (row.agent_name as string) || "unknown",
        totalCostUsd: row.total_cost_usd as number,
        totalCredits: row.total_credits as number,
        turnCount: row.turn_count as number,
        percentage: 0,
      });
    }
    stmt.free();

    const totalCost = rows.reduce((sum, r) => sum + r.totalCostUsd, 0);
    for (const row of rows) {
      row.percentage = totalCost > 0 ? (row.totalCostUsd / totalCost) * 100 : 0;
    }

    return rows;
  }

  getAgentBreakdownSince(sinceMs: number, workspace?: string): AgentBreakdown[] {
    if (!this.db) { return []; }

    const safeSince = Number.isFinite(sinceMs) ? Math.floor(sinceMs) : 0;

    const stmt = this.db.prepare(`
      SELECT agent_name, SUM(cost_usd) as total_cost_usd, SUM(credits) as total_credits, COUNT(*) as turn_count
      FROM turns
      WHERE timestamp >= :since
        AND (:workspace IS NULL OR workspace = :workspace)
      GROUP BY agent_name
      ORDER BY total_cost_usd DESC
    `);
    stmt.bind({
      ":since": safeSince,
      ":workspace": workspace ?? null,
    });

    const rows: AgentBreakdown[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push({
        agentName: (row.agent_name as string) || "unknown",
        totalCostUsd: row.total_cost_usd as number,
        totalCredits: row.total_credits as number,
        turnCount: row.turn_count as number,
        percentage: 0,
      });
    }
    stmt.free();

    const totalCost = rows.reduce((sum, r) => sum + r.totalCostUsd, 0);
    for (const row of rows) {
      row.percentage = totalCost > 0 ? (row.totalCostUsd / totalCost) * 100 : 0;
    }

    return rows;
  }

  getDailyAgentBreakdown(days: number = 365, workspace?: string): DailyAgentBreakdown[] {
    if (!this.db) { return []; }

    const safeDays = this.clampInt(days, 1, 3650);
    const since = Date.now() - safeDays * 24 * 60 * 60 * 1000;

    const stmt = this.db.prepare(`
      SELECT
        date(timestamp / 1000, 'unixepoch') as period,
        agent_name,
        SUM(cost_usd) as total_cost_usd,
        SUM(credits) as total_credits,
        COUNT(*) as turn_count
      FROM turns
      WHERE timestamp >= :since
        AND (:workspace IS NULL OR workspace = :workspace)
      GROUP BY period, agent_name
      ORDER BY period ASC, total_cost_usd DESC
    `);
    stmt.bind({
      ":since": since,
      ":workspace": workspace ?? null,
    });

    const rows: DailyAgentBreakdown[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push({
        period: row.period as string,
        agentName: (row.agent_name as string) || "unknown",
        totalCostUsd: row.total_cost_usd as number,
        totalCredits: row.total_credits as number,
        turnCount: row.turn_count as number,
      });
    }
    stmt.free();

    return rows;
  }

  /**
   * Get total cost for current month.
   */
  getCurrentMonthTotal(workspace?: string): { costUsd: number; credits: number; turns: number } {
    if (!this.db) {return { costUsd: 0, credits: 0, turns: 0 };}

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const stmt = this.db.prepare(`
      SELECT 
        COALESCE(SUM(cost_usd), 0) as total_cost,
        COALESCE(SUM(credits), 0) as total_credits,
        COUNT(*) as turn_count
      FROM turns
      WHERE timestamp >= :monthStart
        AND (:workspace IS NULL OR workspace = :workspace)
    `);
    stmt.bind({
      ":monthStart": monthStart,
      ":workspace": workspace ?? null,
    });

    if (!stmt.step()) {
      stmt.free();
      return { costUsd: 0, credits: 0, turns: 0 };
    }

    const row = stmt.getAsObject();
    stmt.free();
    return {
      costUsd: row.total_cost as number,
      credits: row.total_credits as number,
      turns: row.turn_count as number,
    };
  }

  /**
   * Get total credits consumed since a given timestamp.
   * Used for billing period totals and session delta.
   */
  getCreditsSince(sinceMs: number): number {
    if (!this.db) { return 0; }

    const safeSince = Number.isFinite(sinceMs) ? Math.floor(sinceMs) : 0;
    const stmt = this.db.prepare("SELECT COALESCE(SUM(credits), 0) as total_credits FROM turns WHERE timestamp >= :since");
    stmt.bind({ ":since": safeSince });
    if (!stmt.step()) {
      stmt.free();
      return 0;
    }
    const row = stmt.getAsObject();
    stmt.free();
    return row.total_credits as number;
  }

  /**
   * Get aggregated cost since a given timestamp.
   */
  getCostSince(sinceMs: number, workspace?: string): { costUsd: number; credits: number; turns: number } {
    if (!this.db) {return { costUsd: 0, credits: 0, turns: 0 };}

    const safeSince = Number.isFinite(sinceMs) ? Math.floor(sinceMs) : 0;
    const stmt = this.db.prepare(`
      SELECT 
        COALESCE(SUM(cost_usd), 0) as total_cost,
        COALESCE(SUM(credits), 0) as total_credits,
        COUNT(*) as turn_count
      FROM turns
      WHERE timestamp >= :since
        AND (:workspace IS NULL OR workspace = :workspace)
    `);
    stmt.bind({
      ":since": safeSince,
      ":workspace": workspace ?? null,
    });

    if (!stmt.step()) {
      stmt.free();
      return { costUsd: 0, credits: 0, turns: 0 };
    }

    const row = stmt.getAsObject();
    stmt.free();
    return {
      costUsd: row.total_cost as number,
      credits: row.total_credits as number,
      turns: row.turn_count as number,
    };
  }

  /**
   * Get all unique workspace IDs.
   */
  getWorkspaces(): string[] {
    if (!this.db) {return [];}

    const result = this.db.exec("SELECT DISTINCT workspace FROM turns ORDER BY workspace");
    if (result.length === 0) {return [];}

    return result[0].values.map((row) => row[0] as string);
  }

  /**
   * Persist the database to disk.
   */
  save(): void {
    if (!this.db) {return;}

    const fs = require("node:fs");
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  /**
   * Prune turns older than the specified number of days (retention policy).
   * Keeps at least one entry per session to preserve history metadata.
   * Returns the number of rows deleted.
   */
  pruneOldTurns(retentionDays: number): number {
    if (!this.db) { return 0; }

    const safeDays = Math.max(1, Math.min(3650, retentionDays));
    const cutoffMs = Date.now() - safeDays * 24 * 60 * 60 * 1000;

    // Count old turns before pruning
    const beforeResult = this.db.exec(`SELECT COUNT(*) as count FROM turns WHERE timestamp < ${cutoffMs}`);
    const countBefore = beforeResult.length > 0 ? (beforeResult[0].values[0][0] as number) : 0;

    // Delete turns older than cutoff, but keep the most recent turn per session for history
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

    // Count old turns after pruning (should be minimal, only the session maxes)
    const afterResult = this.db.exec(`SELECT COUNT(*) as count FROM turns WHERE timestamp < ${cutoffMs}`);    const countAfter = afterResult.length > 0 ? (afterResult[0].values[0][0] as number) : 0;
    // Return the number of rows that were deleted
    return Math.max(0, countBefore - countAfter);
  }

  /**
   * Get insight metrics: cache hit rate, I/O token ratio trend, and error count.
   * Used by the Insights dashboard tab.
   */
  getInsightMetrics(days: number = 30): InsightMetrics {
    if (!this.db) {
      return { totalInputTokens: 0, totalOutputTokens: 0, totalCachedTokens: 0, errorTurns: 0, totalTurns: 0, cacheHitPct: 0, ioRatioDays: [] };
    }

    const safeDays = this.clampInt(days, 1, 3650);
    const since = Date.now() - safeDays * 24 * 60 * 60 * 1000;

    // Aggregate totals and error count
    const totalsResult = this.db.exec(`
      SELECT
        COALESCE(SUM(input_tokens), 0),
        COALESCE(SUM(output_tokens), 0),
        COALESCE(SUM(cached_tokens), 0),
        COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0),
        COUNT(*)
      FROM turns WHERE timestamp >= ${since}
    `);

    let totalInputTokens = 0, totalOutputTokens = 0, totalCachedTokens = 0, errorTurns = 0, totalTurns = 0;
    if (totalsResult.length > 0 && totalsResult[0].values.length > 0) {
      const row = totalsResult[0].values[0];
      totalInputTokens = (row[0] as number) || 0;
      totalOutputTokens = (row[1] as number) || 0;
      totalCachedTokens = (row[2] as number) || 0;
      errorTurns = (row[3] as number) || 0;
      totalTurns = (row[4] as number) || 0;
    }

    // input_tokens in the turns table is the net (non-cached) portion; totalInput = input + cached
    const totalBillableInput = totalInputTokens + totalCachedTokens;
    const cacheHitPct = totalBillableInput > 0
      ? Math.round((totalCachedTokens / totalBillableInput) * 1000) / 10
      : 0;

    // Daily breakdown for trend chart
    const dailyResult = this.db.exec(`
      SELECT
        date(timestamp / 1000, 'unixepoch') as period,
        SUM(input_tokens), SUM(output_tokens), SUM(cached_tokens)
      FROM turns WHERE timestamp >= ${since}
      GROUP BY period ORDER BY period ASC
    `);

    const ioRatioDays: InsightMetrics["ioRatioDays"] = [];
    if (dailyResult.length > 0) {
      for (const row of dailyResult[0].values) {
        ioRatioDays.push({
          period: row[0] as string,
          inputTokens: (row[1] as number) || 0,
          outputTokens: (row[2] as number) || 0,
          cachedTokens: (row[3] as number) || 0,
        });
      }
    }

    return { totalInputTokens, totalOutputTokens, totalCachedTokens, errorTurns, totalTurns, cacheHitPct, ioRatioDays };
  }

  /**
   * Get raw metrics used by the insight engine to generate actionable alerts.
   * Covers: output verbosity, session context size, and cache decay idle gaps.
   */
  getAlertMetrics(
    sinceMs: number,
    thresholds?: Partial<AlertThresholdConfig>
  ): AlertMetrics {
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

    const cfg = this.getAlertThresholdConfig(thresholds);
    const { avgOutputTokensToday, turnsToday } = this.getVerbosityMetrics(sinceMs);
    const maxSessionInputTokens = this.getMaxSessionInputTokensSince(sinceMs);
    const maxIdleGapMs = this.getMaxIdleGapMsSince(sinceMs);
    const {
      microTurnCount,
      microTurnAvgOutput,
      rawPasteMaxNetInput,
      premiumMisallocationCount,
      premiumMisallocationAvgCredits,
      massiveContextMaxInput,
    } = this.getThresholdAlertMetrics(sinceMs, cfg);

    return {
      avgOutputTokensToday,
      turnsToday,
      maxSessionInputTokens,
      maxIdleGapMs,
      microTurnCount,
      microTurnAvgOutput,
      rawPasteMaxNetInput,
      premiumMisallocationCount,
      premiumMisallocationAvgCredits,
      massiveContextMaxInput,
    };
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.save();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
