import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import type { TraceSpan, SurfaceBreakdown, TurnDiscoveryRow } from "./types";
export type { TraceSpan, SurfaceBreakdown, TurnDiscoveryRow };
import { formatAgentName } from "./surfaceLabels";
import { buildTurnDiscovery } from "./turnDiscovery";

export class TracesDbReader {
  private readonly dbPath: string;
  private wasmPath: string | undefined;
  private cachedSqlPromise: ReturnType<typeof initSqlJs> | undefined;

  constructor(wasmPath?: string) {
    this.dbPath = this.getTracesDbPath();
    this.wasmPath = wasmPath;
  }

  private getTracesDbPath(): string {
    const homeDir = os.homedir();
    const platform = os.platform();

    let basePath: string;
    if (platform === "win32") {
      basePath = path.join(homeDir, "AppData", "Roaming", "Code", "User");
    } else if (platform === "darwin") {
      basePath = path.join(homeDir, "Library", "Application Support", "Code", "User");
    } else {
      basePath = path.join(homeDir, ".config", "Code", "User");
    }

    return path.join(basePath, "globalStorage", "github.copilot-chat", "agent-traces.db");
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
    };
  }

  private getSqlJs(): ReturnType<typeof initSqlJs> {
    if (!this.cachedSqlPromise) {
      this.cachedSqlPromise = initSqlJs({
        locateFile: () => this.wasmPath ?? path.join(__dirname, "sql-wasm.wasm"),
      });
    }
    return this.cachedSqlPromise;
  }

  private buildTokenFilter(sinceMs: number | undefined, extra?: string): { clause: string; params: unknown[] } {
    const conditions = ["(input_tokens > 0 OR output_tokens > 0 OR cached_tokens > 0)"];
    const params: unknown[] = [];
    if (sinceMs !== undefined) {
      conditions.push("start_time_ms > ?");
      params.push(sinceMs);
    }
    if (extra) {
      conditions.push(extra);
    }
    return { clause: `WHERE ${conditions.join(" AND ")}`, params };
  }

  private async openDb(): Promise<{ db: Database; close: () => void }> {
    const fileBuffer = fs.readFileSync(this.dbPath);
    const SQL = await this.getSqlJs();
    const db = new SQL.Database(fileBuffer);
    return { db, close: () => db.close() };
  }

  async querySpans(sinceMs?: number): Promise<TraceSpan[]> {
    if (!this.exists()) return [];

    const { db, close } = await this.openDb();

    try {
      const { clause, params } = this.buildTokenFilter(sinceMs);

      const stmt = db.prepare(
        `SELECT span_id, trace_id, parent_span_id, name, start_time_ms, end_time_ms,
                status_code, operation_name, provider_name, agent_name, conversation_id,
                request_model, response_model, input_tokens, output_tokens, cached_tokens,
                reasoning_tokens, tool_name, chat_session_id, turn_index, ttft_ms
         FROM spans ${clause}
         ORDER BY start_time_ms ASC`
      );

      if (params.length > 0) {
        stmt.bind(params);
      }

      const results: TraceSpan[] = [];
      while (stmt.step()) {
        results.push(this.mapSpan(stmt.getAsObject() as Record<string, unknown>));
      }
      stmt.free();
      return results;
    } finally {
      close();
    }
  }

  async getSurfaceBreakdown(sinceMs?: number): Promise<SurfaceBreakdown[]> {
    if (!this.exists()) return [];

    const { db, close } = await this.openDb();

    try {
      const { clause, params } = this.buildTokenFilter(sinceMs);

      const stmt = db.prepare(`
        SELECT agent_name,
               COUNT(*)            AS span_count,
               SUM(input_tokens)   AS total_input,
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

    } finally {
      close();
    }
  }

  async getTurnDiscovery(sinceMs?: number): Promise<TurnDiscoveryRow[]> {
    if (!this.exists()) return [];

    const { db, close } = await this.openDb();

    try {
      const conditions = ["chat_session_id IS NOT NULL"];
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
    } finally {
      close();
    }
  }
}
