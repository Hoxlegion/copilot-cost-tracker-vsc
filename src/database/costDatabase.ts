import * as path from "node:path";
import * as fs from "node:fs";
import initSqlJs, { Database } from "sql.js";
import { ParsedTurn, AGGREGATE_AGENT_NAME, TurnSource } from "../parser/types";
import { createTables } from "./schema";
import * as queries from "./queries";
import * as metrics from "./metrics";
import type {
  CostReader,
  CostWriter,
  CostMaintenance,
  CliStore,
  CliSourceState,
  CliSourceStatus,
  CliSessionInfo,
  CostedTurn,
  SourceCost,
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
  CliStore,
  CliSourceState,
  CliSourceStatus,
  CliSessionInfo,
  CostedTurn,
  SourceCost,
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

export class CostDatabase implements CostReader, CostWriter, CostMaintenance, CliStore {
  private db: Database | null = null;
  private readonly dbPath: string;
  private saving: boolean = false;
  private wasCorrupted: boolean = false;
  // Header versions of the last persisted image; -1 means nothing was persisted yet.
  private savedSchemaVersion = -1;
  private savedUserVersion = -1;
  private exportNotWritten = false;

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
      if (data && !this.wasCorrupted) this.recordPersistedVersions(this.db);
      createTables(this.db);
      this.runMigrations(this.db);
    } catch (err) {
      console.warn(`[CostDatabase] Failed to create tables, resetting database. Error: ${err}`);
      this.db.close();
      this.db = new SQL.Database();
      this.wasCorrupted = true;
      this.savedSchemaVersion = -1;
      this.savedUserVersion = -1;
      createTables(this.db);
      this.runMigrations(this.db);
    }
  }

  private recordPersistedVersions(db: Database): void {
    this.savedSchemaVersion = readPragma(db, "schema_version");
    this.savedUserVersion = readPragma(db, "user_version");
  }

  /**
   * True when the in-memory database differs from the last written file. `export()` reopens the
   * connection, which resets `total_changes()`; DDL and `user_version` are tracked separately.
   */
  private hasUnsavedChanges(db: Database): boolean {
    return this.exportNotWritten
      || Number(db.exec("SELECT total_changes()")[0]?.values[0]?.[0] ?? 0) > 0
      || readPragma(db, "schema_version") !== this.savedSchemaVersion
      || readPragma(db, "user_version") !== this.savedUserVersion;
  }

  private exportForSave(db: Database): Uint8Array {
    const data = db.export();
    this.recordPersistedVersions(db);
    return data;
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
    // Migration completion is tracked via PRAGMA user_version instead of a fake
    // session row so it no longer pollutes the sessions table. The user_version
    // counter is shared across data migrations: v1 = cache-token semantics (see
    // recomputeCacheTokenSemantics), v2 = this session dedup. We therefore only
    // advance the counter once v1 has already run, so we never skip it.
    const CACHE_MIGRATION_VERSION = 1;
    const MERGE_MIGRATION_VERSION = 2;
    const currentVersion = Number(db.exec("PRAGMA user_version")[0]?.values?.[0]?.[0] ?? 0);

    // Migrate any legacy sentinel-row bookkeeping to user_version, then remove the
    // sentinel so it no longer appears in the sessions table.
    const legacyMarker = db.exec("SELECT 1 FROM sessions WHERE session_id = '__migration_merge_v2__'");
    const hadLegacyMarker = legacyMarker.length > 0 && legacyMarker[0].values.length > 0;
    if (hadLegacyMarker) {
      db.run("DELETE FROM sessions WHERE session_id = '__migration_merge_v2__'");
      if (currentVersion >= CACHE_MIGRATION_VERSION && currentVersion < MERGE_MIGRATION_VERSION) {
        db.run(`PRAGMA user_version = ${MERGE_MIGRATION_VERSION}`);
      }
      return;
    }

    if (currentVersion >= MERGE_MIGRATION_VERSION) return;

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
    // This cleans up duplicates from the title mapping bug that mapped to both parent and conversation IDs.
    // Copilot CLI sessions are excluded: their generated titles repeat and their rows are replaced per session.
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
      WHERE s1.session_id NOT IN (SELECT session_id FROM cli_sources)
        AND s2.session_id NOT IN (SELECT session_id FROM cli_sources)
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

    // Mark migration as done so it doesn't re-run — but only once the v1
    // (cache-token) migration has run, so we never skip it. If v1 hasn't run yet,
    // leave the counter untouched; this idempotent dedup will re-run next pass.
    if (currentVersion >= CACHE_MIGRATION_VERSION) {
      db.run(`PRAGMA user_version = ${MERGE_MIGRATION_VERSION}`);
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

  insertTurn(turn: ParsedTurn, costUsd: number, credits: number, workspace: string): boolean {
    if (!this.db) {
      if (!this.nullDbWarned) {
        this.nullDbWarned = true;
        console.warn("[CostDatabase] insertTurn called before database initialized — data is being dropped");
      }
      return false;
    }
    // The WHERE clause turns re-ingested, unchanged turns into no-ops so they neither count as
    // changes nor make the database dirty.
    this.db.run(
      `INSERT INTO turns
        (session_id, timestamp, duration, agent_name, model, model_family, input_tokens, output_tokens, cached_tokens, cache_write_tokens, total_tokens, cost_usd, credits, workspace, status, cost_source, source, request_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, timestamp, model) DO UPDATE SET
         cost_usd = CASE WHEN excluded.cost_source = 'real' AND cost_source != 'real' THEN excluded.cost_usd ELSE cost_usd END,
         credits = CASE WHEN excluded.cost_source = 'real' AND cost_source != 'real' THEN excluded.credits ELSE credits END,
         cost_source = CASE WHEN excluded.cost_source = 'real' AND cost_source != 'real' THEN excluded.cost_source ELSE cost_source END,
         -- Self-heal workspace to an authoritative repo label ("Org/Repo") when a
         -- later ingest provides one; never let a non-repo fallback overwrite it.
         workspace = CASE WHEN instr(excluded.workspace, '/') > 0 THEN excluded.workspace ELSE workspace END
       WHERE (excluded.cost_source = 'real' AND turns.cost_source != 'real')
          OR (instr(excluded.workspace, '/') > 0 AND excluded.workspace != turns.workspace)`,
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
        turn.source ?? "chat",
        turn.requestCount ?? 1,
      ]
    );
    return this.db.getRowsModified() > 0;
  }

  /**
   * One-time migration (data version 1) correcting cache-token semantics for turns that
   * were ingested before the fix:
   *  - removes uncredited "GitHub Copilot Chat" conversation roll-up/duplicate turns,
   *  - rewrites `input_tokens` to the non-cached portion (it previously included
   *    `cached_tokens`, double-counting cache reads),
   *  - recomputes `total_tokens`, and
   *  - recomputes `cost_usd`/`credits` for estimated turns via the supplied callback
   *    (real-credit turns keep GitHub's authoritative value).
   * Idempotent: guarded by `PRAGMA user_version`. Returns true only when it ran.
   */
  recomputeCacheTokenSemantics(
    recost: (turn: {
      modelFamily: string;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      cacheWriteTokens: number;
    }) => { costUsd: number; credits: number }
  ): boolean {
    if (!this.db) return false;
    const db = this.db;
    const CURRENT_DATA_VERSION = 1;

    const versionResult = db.exec("PRAGMA user_version");
    const version = Number(versionResult[0]?.values?.[0]?.[0] ?? 0);
    if (version >= CURRENT_DATA_VERSION) return false;

    db.run("BEGIN");
    try {
      // 1. Drop uncredited conversation-level roll-up/duplicate turns.
      db.run(
        "DELETE FROM turns WHERE agent_name = ? AND cost_source != 'real'",
        [AGGREGATE_AGENT_NAME]
      );

      // 2. `input_tokens` previously included `cached_tokens`; keep only the non-cached
      //    portion and recompute `total_tokens`. RHS uses the original row values.
      db.run(`
        UPDATE turns SET
          total_tokens = MAX(input_tokens - cached_tokens, 0) + output_tokens + cached_tokens + cache_write_tokens,
          input_tokens = MAX(input_tokens - cached_tokens, 0)
        WHERE source = 'chat'
      `);

      // 3. Recompute cost for estimated turns with the corrected formula (free models -> 0).
      const sel = db.prepare(
        `SELECT id, model_family, input_tokens, output_tokens, cached_tokens, cache_write_tokens
         FROM turns WHERE cost_source != 'real' AND source = 'chat'`
      );
      const upd = db.prepare("UPDATE turns SET cost_usd = ?, credits = ? WHERE id = ?");
      while (sel.step()) {
        const r = sel.getAsObject();
        const { costUsd, credits } = recost({
          modelFamily: String(r.model_family ?? "unknown"),
          inputTokens: Number(r.input_tokens ?? 0),
          outputTokens: Number(r.output_tokens ?? 0),
          cachedTokens: Number(r.cached_tokens ?? 0),
          cacheWriteTokens: Number(r.cache_write_tokens ?? 0),
        });
        upd.bind([costUsd, credits, r.id as number]);
        upd.step();
        upd.reset();
      }
      sel.free();
      upd.free();

      db.run(`PRAGMA user_version = ${CURRENT_DATA_VERSION}`);
      db.run("COMMIT");
      return true;
    } catch (err) {
      db.run("ROLLBACK");
      console.warn(`[CostDatabase] cache-token semantics migration failed (non-fatal): ${err}`);
      return false;
    }
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
    this.db.run("BEGIN");
    try {
      for (const [sessionId, title] of titles) {
        ensureSessionStmt.bind([Date.now(), sessionId]);
        ensureSessionStmt.step();
        ensureSessionStmt.reset();

        stmt.bind({ ":title": title, ":id": sessionId });
        stmt.step();
        stmt.reset();
      }
      this.db.run("COMMIT");
    } catch (e) {
      this.db.run("ROLLBACK");
      throw e;
    } finally {
      ensureSessionStmt.free();
      stmt.free();
    }
  }

  // ── Copilot CLI ─────────────────────────────────────────────

  getCliSourceStates(): Map<string, CliSourceState> {
    const states = new Map<string, CliSourceState>();
    if (!this.db) return states;
    const stmt = this.db.prepare("SELECT session_id, file_path, size, mtime_ms, status, last_event_ms FROM cli_sources");
    while (stmt.step()) {
      const row = stmt.getAsObject();
      states.set(row.session_id as string, {
        sessionId: row.session_id as string,
        filePath: row.file_path as string,
        size: row.size as number,
        mtimeMs: row.mtime_ms as number,
        status: row.status as CliSourceStatus,
        lastEventMs: row.last_event_ms as number,
      });
    }
    stmt.free();
    return states;
  }

  replaceCliSession(state: CliSourceState, session: CliSessionInfo | null, rows: CostedTurn[]): boolean {
    if (!this.db) return false;
    const db = this.db;
    if (this.cliUsageMatches(db, state.sessionId, session, rows)) {
      const stored = db.exec(
        "SELECT file_path, size, mtime_ms, status, last_event_ms FROM cli_sources WHERE session_id = ?",
        [state.sessionId],
      )[0]?.values[0];
      const sameSource = stored !== undefined
        && stored[0] === state.filePath
        && stored[1] === state.size
        && stored[2] === state.mtimeMs
        && stored[3] === state.status
        && stored[4] === state.lastEventMs;
      if (!sameSource) this.writeCliSource(db, state);
      return stored?.[3] !== state.status;
    }
    db.run("BEGIN");
    try {
      db.run("DELETE FROM turns WHERE source = 'cli' AND session_id = ?", [state.sessionId]);
      for (const { turn, costUsd, credits, workspace } of rows) {
        this.insertTurn({ ...turn, sessionId: state.sessionId, source: "cli" }, costUsd, credits, workspace);
      }
      if (session) {
        db.run(
          `INSERT INTO sessions
            (session_id, workspace, start_timestamp, last_timestamp, copilot_version, vscode_version, processed_at, title)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             workspace = excluded.workspace,
             start_timestamp = excluded.start_timestamp,
             last_timestamp = excluded.last_timestamp,
             copilot_version = COALESCE(excluded.copilot_version, copilot_version),
             processed_at = excluded.processed_at,
             title = COALESCE(excluded.title, title)`,
          [state.sessionId, session.workspace, session.startTimestamp, session.lastTimestamp, session.copilotVersion, Date.now(), session.title],
        );
      }
      this.writeCliSource(db, state);
      db.run("COMMIT");
    } catch (err) {
      db.run("ROLLBACK");
      throw err;
    }
    return true;
  }

  /** True when the stored CLI rows and session details already equal what would be written. */
  private cliUsageMatches(db: Database, sessionId: string, session: CliSessionInfo | null, rows: CostedTurn[]): boolean {
    if (session) {
      const stored = db.exec(
        "SELECT workspace, start_timestamp, last_timestamp, copilot_version, title FROM sessions WHERE session_id = ?",
        [sessionId],
      )[0]?.values[0];
      if (
        !stored
        || stored[0] !== session.workspace
        || stored[1] !== session.startTimestamp
        || stored[2] !== session.lastTimestamp
        || (session.copilotVersion !== null && stored[3] !== session.copilotVersion)
        || (session.title !== null && stored[4] !== session.title)
      ) {
        return false;
      }
    }

    const byTimeAndModel = (a: unknown[], b: unknown[]): number =>
      Number(a[0]) - Number(b[0]) || (String(a[3]) < String(b[3]) ? -1 : String(a[3]) > String(b[3]) ? 1 : 0);
    const stored: unknown[][] = [];
    const stmt = db.prepare(
      `SELECT timestamp, duration, agent_name, model, model_family, input_tokens, output_tokens, cached_tokens,
              cache_write_tokens, total_tokens, cost_usd, credits, workspace, status, cost_source, request_count
       FROM turns WHERE source = 'cli' AND session_id = ?`,
    );
    stmt.bind([sessionId]);
    while (stmt.step()) stored.push(stmt.get());
    stmt.free();
    if (stored.length !== rows.length) return false;

    const next = rows.map(({ turn, costUsd, credits, workspace }) => [
      turn.timestamp, turn.duration, turn.agentName ?? "unknown", turn.model, turn.modelFamily,
      turn.inputTokens, turn.outputTokens, turn.cachedTokens, turn.cacheWriteTokens, turn.totalTokens,
      costUsd, credits, workspace, turn.status, turn.costSource ?? "estimated", turn.requestCount ?? 1,
    ]);
    return JSON.stringify(stored.sort(byTimeAndModel)) === JSON.stringify(next.sort(byTimeAndModel));
  }

  markCliSource(state: CliSourceState): void {
    if (!this.db) return;
    this.writeCliSource(this.db, state);
  }

  hasChatTurns(sessionId: string): boolean {
    if (!this.db) return false;
    const stmt = this.db.prepare("SELECT 1 FROM turns WHERE session_id = :sessionId AND source = 'chat' LIMIT 1");
    stmt.bind({ ":sessionId": sessionId });
    const found = stmt.step();
    stmt.free();
    return found;
  }

  deleteCliTurnsShadowedByChat(): string[] {
    if (!this.db) return [];
    const db = this.db;
    const result = db.exec(`
      SELECT DISTINCT c.session_id
      FROM turns c
      WHERE c.source = 'cli'
        AND EXISTS (SELECT 1 FROM turns t WHERE t.session_id = c.session_id AND t.source = 'chat')
    `);
    const sessionIds = (result[0]?.values ?? []).map((row) => row[0] as string);
    if (sessionIds.length === 0) return sessionIds;
    db.run("BEGIN");
    try {
      for (const sessionId of sessionIds) {
        db.run("DELETE FROM turns WHERE source = 'cli' AND session_id = ?", [sessionId]);
        db.run("UPDATE cli_sources SET status = 'shadowed' WHERE session_id = ?", [sessionId]);
      }
      db.run("COMMIT");
    } catch (err) {
      db.run("ROLLBACK");
      throw err;
    }
    return sessionIds;
  }

  private writeCliSource(db: Database, state: CliSourceState): void {
    db.run(
      `INSERT INTO cli_sources (session_id, file_path, size, mtime_ms, status, last_event_ms, parsed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         file_path = excluded.file_path,
         size = excluded.size,
         mtime_ms = excluded.mtime_ms,
         status = excluded.status,
         last_event_ms = excluded.last_event_ms,
         parsed_at = excluded.parsed_at`,
      [state.sessionId, state.filePath, state.size, state.mtimeMs, state.status, state.lastEventMs, Date.now()],
    );
  }

  // ── Sessions ────────────────────────────────────────────────

  getSessionSummaries(workspace?: string, limit: number = 50, source?: TurnSource): SessionSummary[] {
    if (!this.db) return [];
    return queries.getSessionSummaries(this.db, workspace, limit, source);
  }

  getSessionModelBreakdowns(sessionIds: string[]): SessionModelBreakdownRow[] {
    if (!this.db) return [];
    return queries.getSessionModelBreakdowns(this.db, sessionIds);
  }

  getTurnsForSession(sessionId: string, limit: number = 50): StoredTurn[] {
    if (!this.db) return [];
    return queries.getTurnsForSession(this.db, sessionId, limit);
  }

  getAllTurns(): StoredTurn[] {
    if (!this.db) return [];
    return queries.getAllTurns(this.db);
  }

  iterateAllTurns(): Iterable<StoredTurn> {
    return this.db ? queries.iterateAllTurns(this.db) : [];
  }

  // ── Aggregations ────────────────────────────────────

  getModelLatencySamples(days: number = 30, workspace?: string): ModelLatencySample[] {
    if (!this.db) return [];
    return queries.getModelLatencySamples(this.db, days, workspace);
  }

  getDailyCosts(days: number = 30, workspace?: string, source?: TurnSource): AggregatedCost[] {
    if (!this.db) return [];
    return queries.getDailyCosts(this.db, days, workspace, source);
  }

  getDailyCostsSince(sinceMs: number, workspace?: string, source?: TurnSource): AggregatedCost[] {
    if (!this.db) return [];
    return queries.getDailyCostsSince(this.db, sinceMs, workspace, source);
  }

  getModelBreakdown(days: number = 30, workspace?: string, source?: TurnSource): ModelBreakdown[] {
    if (!this.db) return [];
    return queries.getModelBreakdown(this.db, days, workspace, source);
  }

  getModelBreakdownSince(sinceMs: number, workspace?: string, source?: TurnSource): ModelBreakdown[] {
    if (!this.db) return [];
    return queries.getModelBreakdownSince(this.db, sinceMs, workspace, source);
  }

  getAgentBreakdown(days: number = 30, workspace?: string, source?: TurnSource): AgentBreakdown[] {
    if (!this.db) return [];
    return queries.getAgentBreakdown(this.db, days, workspace, source);
  }

  getAgentBreakdownSince(sinceMs: number, workspace?: string, source?: TurnSource): AgentBreakdown[] {
    if (!this.db) return [];
    return queries.getAgentBreakdownSince(this.db, sinceMs, workspace, source);
  }

  getDailyAgentBreakdown(days: number = 365, workspace?: string, source?: TurnSource): DailyAgentBreakdown[] {
    if (!this.db) return [];
    return queries.getDailyAgentBreakdown(this.db, days, workspace, source);
  }

  getCurrentMonthTotal(billingStartDay: number = 1, workspace?: string, source?: TurnSource): { costUsd: number; credits: number; turns: number } {
    if (!this.db) return { costUsd: 0, credits: 0, turns: 0 };
    return queries.getCurrentMonthTotal(this.db, billingStartDay, workspace, source);
  }

  getCreditsSince(sinceMs: number, source?: TurnSource): number {
    if (!this.db) return 0;
    return queries.getCreditsSince(this.db, sinceMs, source);
  }

  getMostRecentModel(): string | null {
    if (!this.db) return null;
    return queries.getMostRecentModel(this.db);
  }

  getCostSince(sinceMs: number, workspace?: string, source?: TurnSource): { costUsd: number; credits: number; turns: number } {
    if (!this.db) return { costUsd: 0, credits: 0, turns: 0 };
    return queries.getCostSince(this.db, sinceMs, workspace, source);
  }

  getCostBySourceSince(sinceMs: number, workspace?: string): SourceCost[] {
    if (!this.db) return [];
    return queries.getCostBySourceSince(this.db, sinceMs, workspace);
  }

  countCliSessionsWithoutUsage(sinceMs: number): number {
    if (!this.db) return 0;
    return queries.countCliSessionsWithoutUsage(this.db, sinceMs);
  }

  getWorkspaces(): string[] {
    if (!this.db) return [];
    return queries.getWorkspaces(this.db);
  }

  // ── Metrics ─────────────────────────────────────────

  getInsightMetrics(days: number = 30, source?: TurnSource): InsightMetrics {
    if (!this.db) {
      return { totalInputTokens: 0, totalOutputTokens: 0, totalCachedTokens: 0, errorTurns: 0, totalTurns: 0, cacheHitPct: 0, ioRatioDays: [] };
    }
    return metrics.getInsightMetrics(this.db, days, source);
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
    source?: TurnSource,
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
    return metrics.getCacheSavingsMetrics(this.db, sinceMs, workspace, calculateSavingsCost, source);
  }

  // ── Context Awareness ───────────────────────────────

  getMostRecentSessionContext(sinceMs: number, workspace?: string): SessionContextInfo | null {
    if (!this.db) return null;
    return queries.getMostRecentSessionContext(this.db, sinceMs, workspace);
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
    if (!this.db || this.saving || !this.hasUnsavedChanges(this.db)) return;
    this.saving = true;
    try {
      const dir = path.dirname(this.dbPath);
      await fs.promises.mkdir(dir, { recursive: true });
      const data = this.exportForSave(this.db);
      this.exportNotWritten = true;
      const tmpPath = this.dbPath + ".tmp";
      await fs.promises.writeFile(tmpPath, data);
      await fs.promises.rename(tmpPath, this.dbPath);
      this.exportNotWritten = false;
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
      if (!this.saving && this.hasUnsavedChanges(this.db)) {
        try {
          const dir = path.dirname(this.dbPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          const data = this.exportForSave(this.db);
          const tmpPath = this.dbPath + ".tmp";
          fs.writeFileSync(tmpPath, data);
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

function readPragma(db: Database, name: "schema_version" | "user_version"): number {
  return Number(db.exec(`PRAGMA ${name}`)[0]?.values[0]?.[0] ?? 0);
}
