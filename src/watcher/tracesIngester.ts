import * as vscode from "vscode";
import { TracesDbReader, TraceSpan, LogParser } from "../parser";
import { PricingEngine } from "../pricing";
import { CostDatabase } from "../database";
import { TelemetrySource, ConfigManager } from "../config";
import { Logger } from "../logger";
import { FileWatcherStrategy } from "./fileWatcherStrategy";

export class TracesIngester implements vscode.Disposable {
  private readonly reader: TracesDbReader;
  private readonly logParser: LogParser;
  private readonly pricing: PricingEngine;
  private readonly database: CostDatabase;
  private readonly configManager: ConfigManager;
  private readonly logger: Logger;
  private readonly workspaceId: string;
  private readonly onDataChanged: vscode.EventEmitter<void>;
  private watcher: FileWatcherStrategy | undefined;
  private isDisposed: boolean = false;

  private lastProcessedTimestamp: number = 0;
  private telemetrySource: TelemetrySource = "auto";
  private activeSource: "database" | "jsonl" = "database";
  private consecutiveEmptyDbPolls: number = 0;
  private static readonly FAILOVER_THRESHOLD_POLLS = 12;
  private lastDbFailoverAtMs: number = 0;
  private static readonly DB_RECOVERY_PROBE_MS = 60_000;
  private static readonly INGEST_BATCH_SIZE = 5_000;

  readonly onDidDataChange: vscode.Event<void>;

  constructor(
    reader: TracesDbReader,
    logParser: LogParser,
    pricing: PricingEngine,
    database: CostDatabase,
    configManager: ConfigManager,
    logger: Logger,
    workspaceId: string = "unknown"
  ) {
    this.reader = reader;
    this.logParser = logParser;
    this.pricing = pricing;
    this.database = database;
    this.configManager = configManager;
    this.logger = logger;
    this.workspaceId = workspaceId;
    this.onDataChanged = new vscode.EventEmitter<void>();
    this.onDidDataChange = this.onDataChanged.event;

    this.lastProcessedTimestamp = database.getMaxTimestamp();
    this.logger.debug(`Recovered watermark: ${this.lastProcessedTimestamp}`);
  }

  setTelemetrySource(source: TelemetrySource): void {
    this.telemetrySource = source;
    if (source === "database") {
      this.activeSource = "database";
      this.consecutiveEmptyDbPolls = 0;
      this.lastDbFailoverAtMs = 0;
    } else if (source === "jsonl") {
      this.activeSource = "jsonl";
    }
    this.logger.debug(`Telemetry source set to: ${source}`);
  }

  getActiveSource(): "database" | "jsonl" {
    return this.activeSource;
  }

  startWatching(watchPath: string | null, debounceMs: number, fallbackIntervalMs: number): void {
    if (this.watcher) {
      this.watcher.dispose();
    }
    this.watcher = new FileWatcherStrategy(watchPath, () => this.ingest(), {
      debounceMs,
      fallbackIntervalMs,
    });
    this.watcher.start();
  }

  updateWatchOptions(debounceMs: number, fallbackIntervalMs: number): void {
    this.watcher?.updateOptions(debounceMs, fallbackIntervalMs);
  }

  setWatchPath(path: string | null): void {
    this.watcher?.updateWatchPath(path);
  }

  async fullIngest(): Promise<number> {
    return this.ingest(0);
  }

  async ingest(sinceOverride?: number): Promise<number> {
    if (this.isDisposed) return 0;

    const source = this.resolveSource();
    let count: number;
    if (source === "database") {
      count = await this.ingestFromTracesDb(sinceOverride);
    } else {
      count = await this.ingestFromJsonl();
    }

    this.syncSessionTitles();

    return count;
  }

  private resolveSource(): "database" | "jsonl" {
    if (this.telemetrySource === "database") return "database";
    if (this.telemetrySource === "jsonl") return "jsonl";

    if (!this.reader.exists()) {
      if (this.activeSource !== "jsonl") {
        this.logger.info("Traces DB not found, falling back to JSONL");
        this.activeSource = "jsonl";
        this.lastDbFailoverAtMs = Date.now();
        this.setWatchPath(null);
      }
      return "jsonl";
    }

    if (this.activeSource === "jsonl") {
      const elapsedSinceFailoverMs = Date.now() - this.lastDbFailoverAtMs;
      if (elapsedSinceFailoverMs < TracesIngester.DB_RECOVERY_PROBE_MS) {
        return "jsonl";
      }
      this.logger.info("Probing traces DB for recovery after JSONL failover");
      this.activeSource = "database";
      this.consecutiveEmptyDbPolls = 0;
      this.setWatchPath(this.reader.path);
    }

    if (this.consecutiveEmptyDbPolls >= TracesIngester.FAILOVER_THRESHOLD_POLLS) {
      this.logger.warn(
        `Traces DB has not produced data for ${this.consecutiveEmptyDbPolls} consecutive polls, falling back to JSONL`
      );
      this.activeSource = "jsonl";
      this.lastDbFailoverAtMs = Date.now();
      this.setWatchPath(null);
      return "jsonl";
    }

    this.activeSource = "database";
    return "database";
  }

  private shouldSkipSpan(span: TraceSpan): boolean {
    if (span.startTimeMs <= this.lastProcessedTimestamp) return true;

    if (span.inputTokens === 0 && span.outputTokens === 0) {
      return true;
    }

    const model = span.responseModel ?? span.requestModel ?? "unknown";
    const excluded = this.configManager.config.excludedModels;
    if (excluded.some((e) => model.toLowerCase().includes(e.toLowerCase()))) {
      return true;
    }

    return false;
  }

  private insertSpanAsTurn(span: TraceSpan): void {
    const model = span.responseModel ?? span.requestModel ?? "unknown";
    const costUsd = this.pricing.calculateCost(
      model,
      span.inputTokens,
      span.outputTokens,
      span.cachedTokens,
      span.cacheWriteTokens
    );
    const credits = this.pricing.costToCredits(costUsd);

    this.database.insertTurn(
      {
        sessionId: span.chatSessionId ?? span.conversationId ?? "unknown",
        timestamp: span.startTimeMs,
        duration: span.endTimeMs - span.startTimeMs,
        agentName: span.agentName ?? "unknown",
        model,
        modelFamily: model,
        inputTokens: span.inputTokens,
        outputTokens: span.outputTokens,
        cachedTokens: span.cachedTokens,
        cacheWriteTokens: span.cacheWriteTokens,
        totalTokens: span.inputTokens + span.outputTokens + span.cachedTokens + span.cacheWriteTokens,
        status: span.statusCode === 0 ? "ok" : "error",
      },
      costUsd,
      credits,
      this.workspaceId
    );
  }

  private async ingestFromTracesDb(sinceOverride?: number): Promise<number> {
    if (this.isDisposed) return 0;

    const since = sinceOverride ?? this.lastProcessedTimestamp;

    let spans: TraceSpan[];
    try {
      spans = await this.reader.querySpans(since > 0 ? since : undefined);
    } catch (err) {
      this.logger.error("Failed to query traces DB, will trigger failover if this continues", err);
      this.consecutiveEmptyDbPolls++;
      return 0;
    }

    if (spans.length === 0) {
      this.consecutiveEmptyDbPolls++;
      return 0;
    }

    this.consecutiveEmptyDbPolls = 0;

    let newCount = 0;
    let maxTimestamp = this.lastProcessedTimestamp;

    this.database.beginTransaction();
    try {
      for (const span of spans) {
        if (this.isDisposed) break;
        if (this.shouldSkipSpan(span)) continue;

        this.insertSpanAsTurn(span);
        newCount++;

        if (span.startTimeMs > maxTimestamp) {
          maxTimestamp = span.startTimeMs;
        }

        if (newCount % TracesIngester.INGEST_BATCH_SIZE === 0) {
          this.database.commitTransaction();
          this.lastProcessedTimestamp = maxTimestamp;
          await this.database.save();
          this.database.beginTransaction();
          this.logger.debug(`Ingested batch of ${TracesIngester.INGEST_BATCH_SIZE} spans (${newCount} total so far)`);
        }
      }

      this.database.commitTransaction();

      const batchMaxTimestamp = spans.at(-1)!.startTimeMs;
      this.lastProcessedTimestamp = Math.max(maxTimestamp, batchMaxTimestamp);
    } catch (err) {
      this.database.rollbackTransaction();
      this.logger.error("Failed during batch insert, rolling back transaction", err);
      return 0;
    }

    if (newCount > 0 && !this.isDisposed) {
      this.onDataChanged.fire();
    }
    return newCount;
  }

  private async ingestFromJsonl(): Promise<number> {
    let sessions;
    try {
      sessions = this.logParser.parseAllSessions();
    } catch (err) {
      this.logger.error("Failed to parse JSONL sessions (fallback source)", err);
      return 0;
    }

    let newTurns = 0;
    for (const session of sessions) {
      const lastProcessedSessionTimestamp = this.database.getSessionLastTimestamp(session.sessionId);
      const sessionTurns = lastProcessedSessionTimestamp == null
        ? session.turns
        : session.turns.filter((turn) => turn.timestamp > lastProcessedSessionTimestamp);

      if (sessionTurns.length === 0) continue;

      for (const turn of sessionTurns) {
        const costUsd = this.pricing.calculateCost(
          turn.modelFamily,
          turn.inputTokens,
          turn.outputTokens,
          turn.cachedTokens,
          turn.cacheWriteTokens
        );
        const credits = this.pricing.costToCredits(costUsd);
        this.database.insertTurn(turn, costUsd, credits, session.workspace ?? "unknown");
        newTurns++;
      }

      this.database.markSessionProcessed(
        session.sessionId,
        session.workspace ?? "unknown",
        session.turns[0]?.timestamp ?? Date.now(),
        session.turns.at(-1)?.timestamp ?? Date.now(),
        session.copilotVersion ?? "unknown",
        session.vscodeVersion ?? "unknown"
      );
    }

    if (newTurns > 0 && !this.isDisposed) {
      this.onDataChanged.fire();
    }
    return newTurns;
  }

  private syncSessionTitles(): void {
    try {
      const titles = this.logParser.discoverSessionTitles();
      if (titles.size > 0) {
        this.database.updateSessionTitles(titles);
        this.database.runLegacySessionDedupMigration();
      }
    } catch (err) {
      this.logger.debug("Failed to sync session titles", err);
    }
  }

  dispose(): void {
    this.isDisposed = true;
    this.watcher?.dispose();
    this.onDataChanged.dispose();
  }
}
