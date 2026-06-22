import * as path from "node:path";
import * as fs from "node:fs";
import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import type { TraceSpan, SurfaceBreakdown, TurnDiscoveryRow } from "./types";
export type { TraceSpan, SurfaceBreakdown, TurnDiscoveryRow };
import { formatAgentName } from "./surfaceLabels";
import { buildTurnDiscovery } from "./turnDiscovery";
import { AGGREGATE_AGENT_NAME } from "./types";
import { getVscodeUserDataPath } from "../shared/paths";

/**
 * Convert a git remote URL into a friendly "Org/Repo" workspace label.
 * Handles https and ssh forms and strips a trailing `.git`. Returns the trimmed
 * input unchanged if it doesn't look like a URL.
 */
export function repoUrlToName(url: string | null | undefined): string | null {
  if (!url) return null;
  let s = url.trim();
  if (!s) return null;
  s = s.replace(/\.git$/i, "");
  s = s.replace(/^[a-z][a-z0-9+\-.]*:\/\//i, ""); // strip scheme://
  s = s.replace(/^[^/@]+@/, ""); // strip user@ (ssh)
  s = s.replace(/^[^/:]+[:/]/, ""); // strip host: or host/
  return s || null;
}

export class TracesDbReader {
  private readonly dbPath: string;
  private wasmPath: string | undefined;
  private cachedSqlPromise: ReturnType<typeof initSqlJs> | undefined;
  private cachedDb: Database | undefined;
  private cachedMtimeMs = -1;
  private cachedSize = -1;

  constructor(wasmPath?: string) {
    this.dbPath = path.join(getVscodeUserDataPath(), "globalStorage", "github.copilot-chat", "agent-traces.db");
    this.wasmPath = wasmPath;
  }

  get path(): string {
    return this.dbPath;
  }

  exists(): boolean {
    return fs.existsSync(this.dbPath);
  }

  setWasmPath(p: string): void {
    this.wasmPath = p;
  }

  private mapSpan(row: Record<string, unknown>): TraceSpan {
    const nanoAiu = row.nano_aiu == null ? undefined : Number(row.nano_aiu);
    return {
      spanId: row.span_id as string,
      traceId: row.trace_id as string,
      parentSpanId: row.parent_span_id as string | null,
      name: row.name as string,
      startTimeMs: Number(row.start_time_ms ?? 0),
      endTimeMs: Number(row.end_time_ms ?? 0),
      statusCode: Number(row.status_code ?? 0),
      operationName: row.operation_name as string | null,
      providerName: row.provider_name as string | null,
      agentName: row.agent_name as string | null,
      conversationId: row.conversation_id as string | null,
      requestModel: row.request_model as string | null,
      responseModel: row.response_model as string | null,
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      cachedTokens: Number(row.cached_tokens ?? 0),
      cacheWriteTokens: 0,
      reasoningTokens: Number(row.reasoning_tokens ?? 0),
      toolName: row.tool_name as string | null,
      chatSessionId: row.chat_session_id as string | null,
      turnIndex: row.turn_index as number | null,
      ttftMs: row.ttft_ms as number | null,
      realCredits: nanoAiu != null && Number.isFinite(nanoAiu) && nanoAiu >= 0 ? nanoAiu / 1_000_000_000 : undefined,
      workspaceRepo: null,
    };
  }

  private getSqlJs(): ReturnType<typeof initSqlJs> {
    this.cachedSqlPromise ??= initSqlJs({
      locateFile: () => this.wasmPath ?? path.join(__dirname, "sql-wasm.wasm"),
    });
    return this.cachedSqlPromise;
  }

  private buildTokenFilter(sinceMs: number | undefined, extra?: string, tableAlias?: string): { clause: string; params: unknown[] } {
    const p = tableAlias ? `${tableAlias}.` : "";
    const conditions = [`(${p}input_tokens > 0 OR ${p}output_tokens > 0 OR ${p}cached_tokens > 0)`];
    const params: unknown[] = [];
    if (sinceMs !== undefined) {
      conditions.push(`${p}start_time_ms > ?`);
      params.push(sinceMs);
    }
    if (extra) {
      conditions.push(extra);
    }
    return { clause: `WHERE ${conditions.join(" AND ")}`, params };
  }

  /**
   * Return a cached sql.js `Database` for the traces file, reloading from disk only
   * when the file's mtime or size changes. The traces DB can be large and queries
   * run frequently (watcher-driven ingests + dashboard refreshes), so re-reading the
   * entire file on every call was a major source of disk I/O.
   */
  private async getDb(): Promise<Database> {
    const stat = fs.statSync(this.dbPath);
    if (this.cachedDb && stat.mtimeMs === this.cachedMtimeMs && stat.size === this.cachedSize) {
      return this.cachedDb;
    }
    this.cachedDb?.close();
    this.cachedDb = undefined;
    const fileBuffer = fs.readFileSync(this.dbPath);
    const SQL = await this.getSqlJs();
    this.cachedDb = new SQL.Database(fileBuffer);
    this.cachedMtimeMs = stat.mtimeMs;
    this.cachedSize = stat.size;
    return this.cachedDb;
  }

  /** Release the cached database handle. Call on extension deactivation. */
  dispose(): void {
    this.cachedDb?.close();
    this.cachedDb = undefined;
    this.cachedMtimeMs = -1;
    this.cachedSize = -1;
  }

  async querySpans(sinceMs?: number): Promise<TraceSpan[]> {
    if (!this.exists()) return [];

    const db = await this.getDb();

    const { clause, params } = this.buildTokenFilter(sinceMs, undefined, "s");

    const stmt = db.prepare(
        `SELECT s.span_id, s.trace_id, s.parent_span_id, s.name, s.start_time_ms, s.end_time_ms,
                s.status_code, s.operation_name, s.provider_name, s.agent_name, s.conversation_id,
                s.request_model, s.response_model, s.input_tokens, s.output_tokens, s.cached_tokens,
                s.reasoning_tokens, s.tool_name, s.chat_session_id, s.turn_index, s.ttft_ms,
                sa.value AS nano_aiu
         FROM spans s
         LEFT JOIN span_attributes sa
           ON sa.span_id = s.span_id AND sa.key = 'copilot_chat.copilot_usage_nano_aiu'
         ${clause}
         ORDER BY s.start_time_ms ASC`
      );

      if (params.length > 0) {
        stmt.bind(params);
      }

      const results: TraceSpan[] = [];
      while (stmt.step()) {
        results.push(this.mapSpan(stmt.getAsObject() as Record<string, unknown>));
      }
      stmt.free();

      // Attribute each span to its session's git repo (if any). The repo
      // attribute is sparse per span but reliable per session, so we map
      // chat_session_id -> repo once and apply it to every span in the batch.
      const repoBySession = this.buildSessionRepoMap(db);
      if (repoBySession.size > 0) {
        for (const span of results) {
          if (span.chatSessionId) {
            span.workspaceRepo = repoBySession.get(span.chatSessionId) ?? null;
          }
        }
      }
      return results;
  }

  /** Map each chat session to a friendly "Org/Repo" label from its git repo attribute. */
  private buildSessionRepoMap(db: Database): Map<string, string> {
    const map = new Map<string, string>();
    try {
      const stmt = db.prepare(`
        SELECT s.chat_session_id AS sid, MAX(a.value) AS repo
        FROM span_attributes a
        JOIN spans s ON s.span_id = a.span_id
        WHERE a.key IN ('copilot_chat.repo.remote_url', 'github.copilot.git.repository')
          AND s.chat_session_id IS NOT NULL
          AND a.value IS NOT NULL AND a.value != ''
        GROUP BY s.chat_session_id
      `);
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        const sid = row.sid as string | null;
        const name = repoUrlToName(row.repo as string | null);
        if (sid && name) {
          map.set(sid, name);
        }
      }
      stmt.free();
    } catch {
      // Attribute table/keys may be absent on older Copilot versions; fall back silently.
    }
    return map;
  }

  async getSurfaceBreakdown(sinceMs?: number): Promise<SurfaceBreakdown[]> {
    if (!this.exists()) return [];

    const db = await this.getDb();

    const { clause, params } = this.buildTokenFilter(
        sinceMs,
        `agent_name IS NOT '${AGGREGATE_AGENT_NAME}'`,
      );

      const stmt = db.prepare(`
        SELECT agent_name,
               COUNT(*)            AS span_count,
               SUM(MAX(input_tokens - cached_tokens, 0)) AS total_input,
               SUM(output_tokens)  AS total_output,
               SUM(cached_tokens)  AS total_cached
        FROM spans ${clause}
        GROUP BY agent_name
        ORDER BY total_input DESC
      `);

      if (params.length > 0) {
        stmt.bind(params);
      }

      const results: SurfaceBreakdown[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        results.push({
          label: formatAgentName(row.agent_name as string | null),
          agentName: row.agent_name as string | null,
          spanCount: (row.span_count as number) || 0,
          inputTokens: (row.total_input as number) || 0,
          outputTokens: (row.total_output as number) || 0,
          cachedTokens: (row.total_cached as number) || 0,
        });
      }
      stmt.free();
      return results;
  }

  async getTurnDiscovery(sinceMs?: number): Promise<TurnDiscoveryRow[]> {
    if (!this.exists()) return [];

    const db = await this.getDb();

    const conditions = ["chat_session_id IS NOT NULL", `agent_name IS NOT '${AGGREGATE_AGENT_NAME}'`];
      const params: unknown[] = [];
      if (sinceMs !== undefined) {
        conditions.push("start_time_ms >= ?");
        params.push(Math.floor(sinceMs));
      }
      const whereClause = `WHERE ${conditions.join(" AND ")}`;

      const stmt = db.prepare(`
        SELECT
          chat_session_id,
          turn_index,
          start_time_ms,
          end_time_ms,
          agent_name,
          request_model,
          response_model,
          input_tokens,
          output_tokens,
          cached_tokens,
          tool_name
        FROM spans
        ${whereClause}
        ORDER BY chat_session_id ASC, start_time_ms ASC
      `);

      if (params.length > 0) {
        stmt.bind(params);
      }

      const rows: unknown[][] = [];
      while (stmt.step()) {
        rows.push((stmt as any).get() as unknown[]);
      }
      stmt.free();

      if (rows.length === 0) return [];
      return buildTurnDiscovery(rows);
  }
}
