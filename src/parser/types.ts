/**
 * Types representing the structure of Copilot Agent Debug Log entries.
 * Based on the JSONL format in:
 * %APPDATA%/Code/User/workspaceStorage/<id>/GitHub.copilot-chat/debug-logs/<session>/main.jsonl
 */

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
