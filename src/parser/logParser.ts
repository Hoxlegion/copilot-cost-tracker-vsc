import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import {
  BaseLogEntry,
  LogEntry,
  ModelsJsonEntry,
  ParsedSession,
  ParsedTurn,
} from "./types";
import { getVscodeUserDataPath } from "../shared/paths";

interface ParsedLogFile {
  firstEntry: LogEntry;
  lastStart: LogEntry | undefined;
  lastActivity: number;
  turns: ParsedTurn[];
}

export class LogParser {
  private readonly debugLogsBasePath: string;
  /** Per-file cache of extracted title entries, keyed by path, invalidated by mtime. */
  private readonly titleFileCache = new Map<string, { mtimeMs: number; entries: Array<[string, string]> }>();

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
   * Parse a session's main log and its delegated/title request logs.
   */
  async parseSession(sessionDir: string): Promise<ParsedSession | null> {
    const mainJsonlPath = path.join(sessionDir, "main.jsonl");

    if (!fs.existsSync(mainJsonlPath)) {
      return null;
    }

    const main = await this.parseLogFile(mainJsonlPath);
    if (!main) return null;
    const turns = main.turns;
    let lastActivity = main.lastActivity;
    let files: string[];
    try {
      files = fs.readdirSync(sessionDir);
    } catch {
      files = [];
    }
    const delegatedLogs = await Promise.all(files
      .filter((file) => file.endsWith(".jsonl") && (file.startsWith("runSubagent-") || file.startsWith("title-")))
      .map((file) => {
        const agentName = file.startsWith("runSubagent-") ? "tool/runSubagent" : "title";
        return this.parseLogFile(path.join(sessionDir, file), main.firstEntry.sid, agentName);
      }));
    for (const delegated of delegatedLogs) {
      if (!delegated) continue;
      turns.push(...delegated.turns);
      lastActivity = Math.max(lastActivity, delegated.lastActivity);
    }
    turns.sort((left, right) => left.timestamp - right.timestamp);

    return {
      sessionId: main.firstEntry.sid,
      startTimestamp: main.lastStart?.ts ?? main.firstEntry.ts,
      lastActivity,
      copilotVersion: (main.lastStart?.attrs?.copilotVersion as string) ?? "unknown",
      vscodeVersion: (main.lastStart?.attrs?.vscodeVersion as string) ?? "unknown",
      turns,
      workspace: this.getWorkspaceId(sessionDir),
    };
  }

  private async parseLogFile(logPath: string, sessionId?: string, agentName = "unknown"): Promise<ParsedLogFile | null> {
    let firstEntry: LogEntry | undefined;
    let lastStart: LogEntry | undefined;
    let lastActivity: number | undefined;
    const turns: ParsedTurn[] = [];
    let skippedLines = 0;
    try {
      const rl = readline.createInterface({
        input: fs.createReadStream(logPath, { encoding: "utf-8" }),
        crlfDelay: Infinity,
      });
      for await (const rawLine of rl) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          const entry = JSON.parse(line) as LogEntry;
          firstEntry ??= entry;
          lastActivity = Math.max(lastActivity ?? entry.ts, entry.ts);
          if (entry.type === "session_start") lastStart = entry;
          if (entry.type === "LLM_request" || entry.type === "llm_request" || entry.name === "llm_request") {
            turns.push(this.parseModelTurn(entry, sessionId ?? firstEntry.sid, agentName));
          }
        } catch {
          skippedLines++;
        }
      }
    } catch {
      return null;
    }

    if (skippedLines > 0) {
      console.warn(`[LogParser] Skipped ${skippedLines} malformed line(s) in ${logPath}`);
    }

    if (!firstEntry) return null;

    return {
      firstEntry,
      lastStart,
      lastActivity: lastActivity ?? firstEntry.ts,
      turns,
    };
  }

  /**
   * Parse a single LLM request entry into a ParsedTurn.
   */
  private parseModelTurn(
    entry: BaseLogEntry,
    sessionId: string,
    fallbackAgentName: string
  ): ParsedTurn {
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
      fallbackAgentName;

    const rawInputTokens =
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

    // Telemetry `input_tokens` includes `cached_tokens` (cache reads are a subset of
    // the prompt). Store only the non-cached portion so that `inputTokens + cachedTokens`
    // equals the full prompt and cost is not charged twice for cached tokens.
    const inputTokens = Math.max(0, rawInputTokens - cachedTokens);

    const totalTokens =
      (attrs.totalTokens as number) ??
      (attrs.total_tokens as number) ??
      inputTokens + outputTokens + cachedTokens + cacheWriteTokens;
    const nanoAiu = attrs.copilotUsageNanoAiu == null ? undefined : Number(attrs.copilotUsageNanoAiu);
    const realCredits = nanoAiu != null && Number.isFinite(nanoAiu) && nanoAiu >= 0 ? nanoAiu / 1_000_000_000 : undefined;

    return {
      sessionId,
      spanId: typeof entry.spanId === "string" && entry.spanId.length > 0 ? entry.spanId : undefined,
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
      realCredits,
      costSource: realCredits == null ? "estimated" : "real",
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
  async parseAllSessions(): Promise<ParsedSession[]> {
    const dirs = this.discoverLogDirectories();
    const sessions: ParsedSession[] = [];

    for (const dir of dirs) {
      const session = await this.parseSession(dir);
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
    // Skip re-reading/re-parsing unchanged title files: this runs on every ingest
    // poll, and title-*.jsonl files rarely change once a session has a title.
    // Open once and stat/read via the same descriptor to avoid a check-then-use
    // race on the path (CodeQL TOCTOU).
    let fd: number;
    try {
      fd = fs.openSync(filePath, "r");
    } catch {
      return;
    }
    try {
      const mtimeMs = fs.fstatSync(fd).mtimeMs;
      const cached = this.titleFileCache.get(filePath);
      if (cached?.mtimeMs === mtimeMs) {
        for (const [id, title] of cached.entries) titles.set(id, title);
        return;
      }
      const content = fs.readFileSync(fd, "utf-8");
      const entries = this.parseTitleEntries(content);
      this.titleFileCache.set(filePath, { mtimeMs, entries });
      for (const [id, title] of entries) titles.set(id, title);
    } catch {
      // Unreadable file — skip it.
    } finally {
      fs.closeSync(fd);
    }
  }

  private parseTitleEntries(content: string): Array<[string, string]> {
    const lines = content.split("\n").filter((l) => l.trim());
    const entries: Array<[string, string]> = [];
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
        if (conversationId) entries.push([conversationId, parsed.title]);
        if (parentSessionId) entries.push([parentSessionId, parsed.title]);
      }
    }

    return entries;
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
