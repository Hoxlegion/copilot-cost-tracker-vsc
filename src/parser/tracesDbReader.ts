import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import initSqlJs from "sql.js";

export interface TraceSpan {
  spanId: string;
  traceId: string;
  parentSpanId: string | null;
  name: string;
  startTimeMs: number;
  endTimeMs: number;
  statusCode: number;
  operationName: string | null;
  providerName: string | null;
  agentName: string | null;
  conversationId: string | null;
  requestModel: string | null;
  responseModel: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  toolName: string | null;
  chatSessionId: string | null;
  turnIndex: number | null;
  ttftMs: number | null;
}

export interface SurfaceBreakdown {
  label: string;
  agentName: string | null;
  spanCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface TurnDiscoveryRow {
  chatSessionId: string;
  turnIndex: number;
  firstTimeMs: number;
  lastTimeMs: number;
  llmCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheHitPct: number;
  models: string[];
  agents: string[];
  tools: string[];
}

/** Maps raw agent_name values from agent-traces.db to human-friendly surface labels. */
function surfaceLabel(agentName: string | null): string {
  switch (agentName) {
    case "panel/editAgent":               return "Inline Chat";
    case "XtabProvider":                  return "Next Edit Suggestions";
    case "GitHub Copilot Chat":           return "Sidebar Chat";
    case "summarizeConversationHistory":  return "Context Summarization";
    case "progressMessages":              return "Background Processing";
    case "title":                         return "Title Generation";
    default:                              return agentName ?? "Other";
  }
}

/**
 * Reader for the agent-traces.db SQLite database that Copilot maintains
 * in globalStorage/github.copilot-chat/agent-traces.db
 *
 * Uses sql.js to read the DB file as an in-memory snapshot (WAL-safe:
 * the main .db file is always consistent in WAL mode).
 */
export class TracesDbReader {
  private readonly dbPath: string;
  private wasmPath: string | undefined;

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

  /**
   * Set the WASM path for sql.js initialization.
   */
  setWasmPath(p: string): void {
    this.wasmPath = p;
  }

  private mapSpanFromObject(row: Record<string, unknown>): TraceSpan {
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
      cacheWriteTokens: 0, // removed from spans schema
      reasoningTokens: Number(row.reasoning_tokens ?? 0),
      toolName: row.tool_name as string | null,
      chatSessionId: row.chat_session_id as string | null,
      turnIndex: row.turn_index as number | null,
      ttftMs: row.ttft_ms as number | null,
    };
  }

  private mapSpanFromArray(row: unknown[]): TraceSpan {
    return {
      spanId: row[0] as string,
      traceId: row[1] as string,
      parentSpanId: row[2] as string | null,
      name: row[3] as string,
      startTimeMs: (row[4] as number) || 0,
      endTimeMs: (row[5] as number) || 0,
      statusCode: (row[6] as number) || 0,
      operationName: row[7] as string | null,
      providerName: row[8] as string | null,
      agentName: row[9] as string | null,
      conversationId: row[10] as string | null,
      requestModel: row[11] as string | null,
      responseModel: row[12] as string | null,
      inputTokens: (row[13] as number) || 0,
      outputTokens: (row[14] as number) || 0,
      cachedTokens: (row[15] as number) || 0,
      cacheWriteTokens: 0, // removed from spans schema
      reasoningTokens: (row[16] as number) || 0,
      toolName: row[17] as string | null,
      chatSessionId: row[18] as string | null,
      turnIndex: row[19] as number | null,
      ttftMs: row[20] as number | null,
    };
  }

  /**
   * Query all LLM spans (those with input_tokens > 0) since a given timestamp.
   * Opens the DB as a read-only in-memory snapshot — no locking, no subprocess.
   */
  async querySpans(sinceMs?: number): Promise<TraceSpan[]> {
    if (!this.exists()) {
      return [];
    }

    // Read the DB file into memory (WAL-safe: main file is always consistent)
    const fileBuffer = fs.readFileSync(this.dbPath);

    const SQL = await initSqlJs({
      locateFile: () => this.wasmPath ?? path.join(__dirname, "sql-wasm.wasm"),
    });

    const db = new SQL.Database(fileBuffer);

    try {
      const whereClause = sinceMs
        ? `WHERE input_tokens > 0 AND start_time_ms > ?`
        : "WHERE input_tokens > 0";

      // Note: cache_write_tokens was removed from the spans schema in a recent
      // Copilot update. We default it to 0 and keep the interface field for compatibility.
      const stmt = db.prepare(
        `SELECT span_id, trace_id, parent_span_id, name, start_time_ms, end_time_ms,
                status_code, operation_name, provider_name, agent_name, conversation_id,
                request_model, response_model, input_tokens, output_tokens, cached_tokens,
                reasoning_tokens, tool_name, chat_session_id, turn_index, ttft_ms
         FROM spans ${whereClause}
         ORDER BY start_time_ms ASC`
      );

      if (sinceMs) {
        stmt.bind([sinceMs]);
      }

      const results: TraceSpan[] = [];

      while (stmt.step()) {
        if (stmt.getAsObject) {
          results.push(this.mapSpanFromObject(stmt.getAsObject() as Record<string, unknown>));
        } else {
          results.push(this.mapSpanFromArray((stmt as any).get() as unknown[]));
        }
      }

      stmt.free();
      return results;
    } finally {
      db.close();
    }
  }

  /**
   * Query surface-level breakdown (which Copilot feature generated the tokens) from the traces DB.
   * Groups by agent_name and filters to spans with input_tokens > 0.
   * Returns [] if the traces DB does not exist.
   */
  async getSurfaceBreakdown(sinceMs?: number): Promise<SurfaceBreakdown[]> {
    if (!this.exists()) {
      return [];
    }

    const fileBuffer = fs.readFileSync(this.dbPath);
    const SQL = await initSqlJs({
      locateFile: () => this.wasmPath ?? path.join(__dirname, "sql-wasm.wasm"),
    });
    const db = new SQL.Database(fileBuffer);

    try {
      const whereClause = sinceMs
        ? `WHERE input_tokens > 0 AND start_time_ms > ${sinceMs}`
        : "WHERE input_tokens > 0";

      const result = db.exec(`
        SELECT agent_name,
               COUNT(*)            AS span_count,
               SUM(input_tokens)   AS total_input,
               SUM(output_tokens)  AS total_output,
               SUM(cached_tokens)  AS total_cached
        FROM spans ${whereClause}
        GROUP BY agent_name
        ORDER BY total_input DESC
      `);

      if (result.length === 0) { return []; }

      return result[0].values.map((row) => ({
        label: surfaceLabel(row[0] as string | null),
        agentName: row[0] as string | null,
        spanCount: (row[1] as number) || 0,
        inputTokens: (row[2] as number) || 0,
        outputTokens: (row[3] as number) || 0,
        cachedTokens: (row[4] as number) || 0,
      }));
    } finally {
      db.close();
    }
  }

  /**
   * Build a compact turn-level discovery view from traces.
   * Groups spans by (chat_session_id, turn_index), counting LLM and tool calls.
   */
  async getTurnDiscovery(sinceMs?: number): Promise<TurnDiscoveryRow[]> {
    if (!this.exists()) {
      return [];
    }

    const fileBuffer = fs.readFileSync(this.dbPath);
    const SQL = await initSqlJs({
      locateFile: () => this.wasmPath ?? path.join(__dirname, "sql-wasm.wasm"),
    });
    const db = new SQL.Database(fileBuffer);

    try {
      const whereClause = sinceMs
        ? `WHERE chat_session_id IS NOT NULL AND turn_index IS NOT NULL AND start_time_ms >= ${Math.floor(sinceMs)}`
        : "WHERE chat_session_id IS NOT NULL AND turn_index IS NOT NULL";

      const result = db.exec(`
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
        ORDER BY start_time_ms DESC
      `);

      if (result.length === 0) {
        return [];
      }

      type Acc = {
        chatSessionId: string;
        turnIndex: number;
        firstTimeMs: number;
        lastTimeMs: number;
        llmCalls: number;
        toolCalls: number;
        inputTokens: number;
        outputTokens: number;
        cachedTokens: number;
        models: Set<string>;
        agents: Set<string>;
        tools: Set<string>;
      };

      const grouped = new Map<string, Acc>();

      for (const row of result[0].values) {
        const chatSessionId = (row[0] as string) || "";
        const turnIndex = Number(row[1] ?? 0);
        const startTimeMs = Number(row[2] ?? 0);
        const endTimeMs = Number(row[3] ?? 0);
        const agentName = (row[4] as string | null) ?? "unknown";
        const requestModel = (row[5] as string | null) ?? "";
        const responseModel = (row[6] as string | null) ?? "";
        const inputTokens = Number(row[7] ?? 0);
        const outputTokens = Number(row[8] ?? 0);
        const cachedTokens = Number(row[9] ?? 0);
        const toolName = (row[10] as string | null) ?? "";

        const key = `${chatSessionId}::${turnIndex}`;
        const acc = grouped.get(key) ?? {
          chatSessionId,
          turnIndex,
          firstTimeMs: startTimeMs,
          lastTimeMs: endTimeMs || startTimeMs,
          llmCalls: 0,
          toolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          models: new Set<string>(),
          agents: new Set<string>(),
          tools: new Set<string>(),
        };

        acc.firstTimeMs = Math.min(acc.firstTimeMs, startTimeMs || acc.firstTimeMs);
        acc.lastTimeMs = Math.max(acc.lastTimeMs, endTimeMs || startTimeMs || acc.lastTimeMs);
        acc.inputTokens += inputTokens;
        acc.outputTokens += outputTokens;
        acc.cachedTokens += cachedTokens;

        const model = responseModel || requestModel;
        if (model) {
          acc.models.add(model);
        }
        if (agentName) {
          acc.agents.add(agentName);
        }

        const isLlmCall = (inputTokens + outputTokens + cachedTokens) > 0;
        if (isLlmCall) {
          acc.llmCalls += 1;
        }

        if (toolName) {
          acc.toolCalls += 1;
          acc.tools.add(toolName);
        }

        grouped.set(key, acc);
      }

      const rows = Array.from(grouped.values()).map((acc) => {
        const billableInput = acc.inputTokens + acc.cachedTokens;
        const cacheHitPct = billableInput > 0 ? (acc.cachedTokens / billableInput) * 100 : 0;
        return {
          chatSessionId: acc.chatSessionId,
          turnIndex: acc.turnIndex,
          firstTimeMs: acc.firstTimeMs,
          lastTimeMs: acc.lastTimeMs,
          llmCalls: acc.llmCalls,
          toolCalls: acc.toolCalls,
          inputTokens: acc.inputTokens,
          outputTokens: acc.outputTokens,
          cachedTokens: acc.cachedTokens,
          cacheHitPct,
          models: Array.from(acc.models).sort(),
          agents: Array.from(acc.agents).sort(),
          tools: Array.from(acc.tools).sort(),
        } as TurnDiscoveryRow;
      });

      rows.sort((a, b) => b.lastTimeMs - a.lastTimeMs);
      return rows;
    } finally {
      db.close();
    }
  }
}
