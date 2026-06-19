import * as fs from "node:fs";
import * as path from "node:path";
import {
  BaseLogEntry,
  LogEntry,
  ModelsJsonEntry,
  ParsedSession,
  ParsedTurn,
} from "./types";
import { getVscodeUserDataPath } from "../shared/paths";

export class LogParser {
  private readonly debugLogsBasePath: string;

  constructor() {
    this.debugLogsBasePath = path.join(getVscodeUserDataPath(), "workspaceStorage");
  }

  /**
   * Discover all debug log directories across all workspaces.
   */
  discoverLogDirectories(): string[] {
    const dirs: string[] = [];

    let workspaces: fs.Dirent[];
    try {
      workspaces = fs.readdirSync(this.debugLogsBasePath, { withFileTypes: true });
    } catch {
      return dirs;
    }

    for (const workspace of workspaces) {
      if (!workspace.isDirectory()) continue;
      const debugLogDir = path.join(
        this.debugLogsBasePath,
        workspace.name,
        "GitHub.copilot-chat",
        "debug-logs"
      );

      let sessions: fs.Dirent[];
      try {
        sessions = fs.readdirSync(debugLogDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const session of sessions) {
        if (!session.isDirectory()) continue;
        const sessionDir = path.join(debugLogDir, session.name);
        try {
          fs.accessSync(path.join(sessionDir, "main.jsonl"));
          dirs.push(sessionDir);
        } catch {
          // main.jsonl doesn't exist, skip
        }
      }
    }

    return dirs;
  }

  /**
   * Get the workspace ID from a session directory path.
   */
  getWorkspaceId(sessionDir: string): string {
    const parts = sessionDir.split(path.sep);
    const wsIndex = parts.indexOf("workspaceStorage");
    if (wsIndex >= 0 && wsIndex + 1 < parts.length) {
      return parts[wsIndex + 1];
    }
    return "unknown";
  }

  /**
   * Parse a single session directory (main.jsonl + models.json).
   */
  parseSession(sessionDir: string): ParsedSession | null {
    const mainJsonlPath = path.join(sessionDir, "main.jsonl");

    if (!fs.existsSync(mainJsonlPath)) {
      return null;
    }

    const content = fs.readFileSync(mainJsonlPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    if (lines.length === 0) {
      return null;
    }

    const entries: LogEntry[] = [];
    let skippedLines = 0;
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as LogEntry);
      } catch {
        skippedLines++;
      }
    }
    if (skippedLines > 0) {
      console.warn(`[LogParser] Skipped ${skippedLines} malformed line(s) in ${mainJsonlPath}`);
    }

    if (entries.length === 0) {
      return null;
    }

    // Find session start info
    const sessionStarts = entries.filter((e) => e.type === "session_start");
    const lastStart = sessionStarts.at(-1);

    const sessionId = entries[0].sid;
    const workspace = this.getWorkspaceId(sessionDir);

    const session: ParsedSession = {
      sessionId,
      startTimestamp: lastStart?.ts ?? entries[0].ts,
      lastActivity: entries.at(-1)?.ts ?? entries[0].ts,
      copilotVersion:
        (lastStart?.attrs?.copilotVersion as string) ?? "unknown",
      vscodeVersion: (lastStart?.attrs?.vscodeVersion as string) ?? "unknown",
      turns: [],
      workspace,
    };

    // Extract LLM request entries (model turns)
    const llmEntries = entries.filter(
      (e) => e.type === "LLM_request" || e.type === "llm_request" || e.name === "llm_request"
    );

    for (const entry of llmEntries) {
      const turn = this.parseModelTurn(entry, sessionId);
      if (turn) {
        session.turns.push(turn);
      }
    }

    return session;
  }

  /**
   * Parse a single LLM request entry into a ParsedTurn.
   */
  private parseModelTurn(
    entry: BaseLogEntry,
    sessionId: string
  ): ParsedTurn | null {
    const attrs = entry.attrs || {};

    // Try multiple possible field names (format may vary across versions)
    const model =
      (attrs.model as string) ??
      (attrs.modelId as string) ??
      (attrs.model_id as string) ??
      "unknown";

    const modelFamily =
      (attrs.modelFamily as string) ??
      (attrs.model_family as string) ??
      (attrs.family as string) ??
      model;

    const agentName =
      (attrs.agentName as string) ??
      (attrs.agent_name as string) ??
      (attrs.surface as string) ??
      "unknown";

    const inputTokens =
      (attrs.inputTokens as number) ??
      (attrs.input_tokens as number) ??
      (attrs.promptTokens as number) ??
      0;

    const outputTokens =
      (attrs.outputTokens as number) ??
      (attrs.output_tokens as number) ??
      (attrs.completionTokens as number) ??
      0;

    const cachedTokens =
      (attrs.cachedTokens as number) ??
      (attrs.cached_tokens as number) ??
      (attrs.cachedInputTokens as number) ??
      0;

    const cacheWriteTokens =
      (attrs.cacheWriteTokens as number) ??
      (attrs.cache_write_tokens as number) ??
      (attrs.cacheCreationInputTokens as number) ??
      0;

    const totalTokens =
      (attrs.totalTokens as number) ??
      (attrs.total_tokens as number) ??
      inputTokens + outputTokens + cachedTokens + cacheWriteTokens;

    return {
      sessionId,
      timestamp: entry.ts,
      duration: entry.dur,
      agentName,
      model,
      modelFamily,
      inputTokens,
      outputTokens,
      cachedTokens,
      cacheWriteTokens,
      totalTokens,
      status: entry.status,
    };
  }

  /**
   * Parse models.json from a session directory.
   */
  parseModelsJson(sessionDir: string): ModelsJsonEntry[] {
    const modelsPath = path.join(sessionDir, "models.json");

    if (!fs.existsSync(modelsPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(modelsPath, "utf-8");
      return JSON.parse(content) as ModelsJsonEntry[];
    } catch {
      return [];
    }
  }

  /**
   * Parse all sessions across all workspaces.
   */
  parseAllSessions(): ParsedSession[] {
    const dirs = this.discoverLogDirectories();
    const sessions: ParsedSession[] = [];

    for (const dir of dirs) {
      const session = this.parseSession(dir);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  /**
   * Get the path to the debug logs for the current workspace storage folder.
   */
  getActiveSessionPaths(): string[] {
    return this.discoverLogDirectories();
  }

  /**
   * Scan all debug-log session directories for title-*.jsonl files and extract
   * session titles. Returns a map of session/conversation ID → title string.
   */
  discoverSessionTitles(): Map<string, string> {
    const titles = new Map<string, string>();
    const dirs = this.discoverLogDirectories();

    for (const dir of dirs) {
      this.extractTitlesFromDir(dir, titles);
    }

    return titles;
  }

  private extractTitlesFromDir(sessionDir: string, titles: Map<string, string>): void {
    let files: string[];
    try {
      files = fs.readdirSync(sessionDir);
    } catch {
      return;
    }

    for (const file of files) {
      if (!file.startsWith("title-") || !file.endsWith(".jsonl")) continue;
      this.extractTitlesFromFile(path.join(sessionDir, file), titles);
    }
  }

  private extractTitlesFromFile(filePath: string, titles: Map<string, string>): void {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      return;
    }

    const lines = content.split("\n").filter((l) => l.trim());
    let conversationId: string | undefined;
    let parentSessionId: string | undefined;

    for (const line of lines) {
      const parsed = this.parseTitleEntry(line);
      if (!parsed) continue;

      conversationId ??= parsed.sid;

      if (parsed.type === "session_start" && parsed.parentSessionId) {
        parentSessionId = parsed.parentSessionId;
      }

      if (parsed.title) {
        if (conversationId) titles.set(conversationId, parsed.title);
        if (parentSessionId) titles.set(parentSessionId, parsed.title);
      }
    }
  }

  private parseTitleEntry(line: string): { sid?: string; type?: string; parentSessionId?: string; title?: string } | null {
    try {
      const entry = JSON.parse(line) as BaseLogEntry;
      const result: { sid?: string; type?: string; parentSessionId?: string; title?: string } = {
        sid: entry.sid,
        type: entry.type,
      };

      if (entry.type === "session_start" && entry.attrs?.parentSessionId) {
        result.parentSessionId = entry.attrs.parentSessionId as string;
      }

      if (entry.type === "agent_response" && entry.attrs?.response) {
        const title = this.extractTitleFromResponse(entry.attrs.response as string);
        if (title) result.title = title;
      }

      return result;
    } catch {
      return null;
    }
  }

  private extractTitleFromResponse(response: string): string | null {
    try {
      const parsed = JSON.parse(response) as Array<{
        role?: string;
        parts?: Array<{ type?: string; content?: string }>;
      }>;
      for (const msg of parsed) {
        if (msg.role === "assistant" && Array.isArray(msg.parts)) {
          for (const part of msg.parts) {
            if (part.type === "text" && part.content) {
              return part.content.trim();
            }
          }
        }
      }
    } catch {
      // Not valid JSON
    }
    return null;
  }

  get basePath(): string {
    return this.debugLogsBasePath;
  }
}
