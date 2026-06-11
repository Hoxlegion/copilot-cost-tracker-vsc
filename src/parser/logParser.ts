import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  BaseLogEntry,
  LogEntry,
  ModelsJsonEntry,
  ParsedSession,
  ParsedTurn,
} from "./types";

export class LogParser {
  private readonly debugLogsBasePath: string;

  constructor() {
    this.debugLogsBasePath = this.getDebugLogsBasePath();
  }

  /**
   * Get the base path where VS Code stores workspace storage.
   */
  private getDebugLogsBasePath(): string {
    const platform = os.platform();
    const homeDir = os.homedir();

    if (platform === "win32") {
      return path.join(
        homeDir,
        "AppData",
        "Roaming",
        "Code",
        "User",
        "workspaceStorage"
      );
    } else if (platform === "darwin") {
      return path.join(
        homeDir,
        "Library",
        "Application Support",
        "Code",
        "User",
        "workspaceStorage"
      );
    } else {
      return path.join(homeDir, ".config", "Code", "User", "workspaceStorage");
    }
  }

  /**
   * Discover all debug log directories across all workspaces.
   */
  discoverLogDirectories(): string[] {
    const dirs: string[] = [];

    if (!fs.existsSync(this.debugLogsBasePath)) {
      return dirs;
    }

    try {
      const workspaces = fs.readdirSync(this.debugLogsBasePath);

      for (const workspace of workspaces) {
        const debugLogDir = path.join(
          this.debugLogsBasePath,
          workspace,
          "GitHub.copilot-chat",
          "debug-logs"
        );

        if (fs.existsSync(debugLogDir)) {
          try {
            const sessions = fs.readdirSync(debugLogDir);
            for (const session of sessions) {
              const sessionDir = path.join(debugLogDir, session);
              const mainJsonl = path.join(sessionDir, "main.jsonl");
              if (fs.existsSync(mainJsonl)) {
                dirs.push(sessionDir);
              }
            }
          } catch (err) {
            console.warn(`[LogParser] Skipping inaccessible debug-log directory: ${debugLogDir}`, err);
          }
        }
      }
    } catch {
      // Skip if base path is inaccessible
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

  get basePath(): string {
    return this.debugLogsBasePath;
  }
}
