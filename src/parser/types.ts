/**
 * Types representing the structure of Copilot Agent Debug Log entries.
 * Based on the JSONL format in:
 * %APPDATA%/Code/User/workspaceStorage/<id>/GitHub.copilot-chat/debug-logs/<session>/main.jsonl
 */

/**
 * Agent name used by Copilot for the outer, conversation-level orchestration span.
 * These spans are roll-ups/duplicates of the actual billed surface spans
 * (e.g. `panel/editAgent`, `tool/runSubagent`) and never carry the `nano_aiu`
 * billing attribute, so they must be excluded to avoid double counting.
 */
export const AGGREGATE_AGENT_NAME = "GitHub Copilot Chat";

export interface BaseLogEntry {
  v: number; // version
  ts: number; // timestamp (ms since epoch)
  dur: number; // duration in ms
  sid: string; // session ID
  type: string; // entry type
  name: string; // entry name
  spanId: string;
  status: string; // "ok" | "error"
  attrs: Record<string, unknown>;
}

export interface SessionStartEntry extends BaseLogEntry {
  type: "session_start";
  attrs: {
    copilotVersion: string;
    vscodeVersion: string;
  };
}

export interface LlmRequestEntry extends BaseLogEntry {
  type: "LLM_request";
  attrs: {
    model?: string;
    modelFamily?: string;
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    cacheWriteTokens?: number;
    totalTokens?: number;
    [key: string]: unknown;
  };
}

export type LogEntry = SessionStartEntry | LlmRequestEntry | BaseLogEntry;

export interface ParsedTurn {
  sessionId: string;
  timestamp: number;
  duration: number;
  agentName?: string;
  model: string;
  modelFamily: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  status: string;
  /** Whether credits are from real billing data or token-based estimates. */
  costSource?: "real" | "estimated";
}

export interface ParsedSession {
  sessionId: string;
  startTimestamp: number;
  lastActivity: number;
  copilotVersion: string;
  vscodeVersion: string;
  turns: ParsedTurn[];
  workspace?: string;
}

export interface ModelsJsonEntry {
  billing?: {
    is_premium: boolean;
    multiplier: number;
    restricted_to: string[];
  };
  capabilities?: {
    family: string;
    limits: {
      max_context_window_tokens: number;
      max_output_tokens: number;
    };
    tokenizer: string;
    type: string;
  };
  id?: string;
  name?: string;
}

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
  /** Real credits from GitHub billing (nano AIU ÷ 1e9). Undefined when not recorded. */
  realCredits: number | undefined;
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
