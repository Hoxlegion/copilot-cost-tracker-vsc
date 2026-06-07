import * as vscode from "vscode";
import { TracesDbReader, TraceSpan, LogParser } from "../parser";
import { PricingEngine } from "../pricing";
import { CostDatabase } from "../database";
import { TelemetrySource, ConfigManager } from "../config";
import { Logger } from "../logger";
import { PollingScheduler } from "./pollingStrategy";

export class TracesIngester implements vscode.Disposable {
  private readonly reader: TracesDbReader;
  private readonly logParser: LogParser;
  private readonly pricing: PricingEngine;
  private readonly database: CostDatabase;
  private readonly configManager: ConfigManager;
  private readonly logger: Logger;
  private readonly onDataChanged: vscode.EventEmitter<void>;
  private readonly scheduler: PollingScheduler;
  private isDisposed: boolean = false;

  private lastProcessedTimestamp: number = 0;
  private telemetrySource: TelemetrySource = "auto";
  private activeSource: "database" | "jsonl" = "database";
  private consecutiveEmptyDbPolls: number = 0;
  private static readonly FAILOVER_THRESHOLD_POLLS = 12;
  private lastDbFailoverAtMs: number = 0;
  private static readonly DB_RECOVERY_PROBE_MS = 60_000;

  readonly onDidDataChange: vscode.Event<void>;

  constructor(
    reader: TracesDbReader,
    logParser: LogParser,
    pricing: PricingEngine,
    database: CostDatabase,
    configManager: ConfigManager,
    logger: Logger
  ) {
    this.reader = reader;
    this.logParser = logParser;
    this.pricing = pricing;
    this.database = database;
    this.configManager = configManager;
    this.logger = logger;
    this.onDataChanged = new vscode.EventEmitter<void>();
    this.onDidDataChange = this.onDataChanged.event;
    this.scheduler = new PollingScheduler();

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

  startPolling(minMs?: number, maxMs?: number): void {
    if (minMs !== undefined || maxMs !== undefined) {
      this.scheduler.updateBounds(minMs ?? 5000, maxMs ?? 60000);
    }
    this.scheduler.start(() => this.ingest());
  }

  updatePollingBounds(minMs: number, maxMs: number): void {
    this.scheduler.updateBounds(minMs, maxMs);
  }

  async fullIngest(): Promise<number> {
    return this.ingest(0);
  }

  async ingest(sinceOverride?: number): Promise<number> {
    if (this.isDisposed) return 0;

    const source = this.resolveSource();
    if (source === "database") {
      return this.ingestFromTracesDb(sinceOverride);
    } else {
      return this.ingestFromJsonl();
    }
  }

  private resolveSource(): "database" | "jsonl" {
    if (this.telemetrySource === "database") return "database";
    if (this.telemetrySource === "jsonl") return "jsonl";

    if (!this.reader.exists()) {
      if (this.activeSource !== "jsonl") {
        this.logger.info("Traces DB not found, falling back to JSONL");
        this.activeSource = "jsonl";
        this.lastDbFailoverAtMs = Date.now();
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
    }

    if (this.consecutiveEmptyDbPolls >= TracesIngester.FAILOVER_THRESHOLD_POLLS) {
      if (this.activeSource !== "jsonl") {
        this.logger.warn(
          `Traces DB has not produced data for ${this.consecutiveEmptyDbPolls} consecutive polls, falling back to JSONL`
        );
        this.activeSource = "jsonl";
        this.lastDbFailoverAtMs = Date.now();
      }
      return "jsonl";
    }

    this.activeSource = "database";
    return "database";
  }

  private shouldSkipSpan(span: TraceSpan): boolean {
    if (span.startTimeMs <= this.lastProcessedTimestamp) return true;

    if (span.inputTokens === 0 && span.outputTokens === 0) {
      this.lastProcessedTimestamp = span.startTimeMs;
      return true;
    }

    const model = span.responseModel ?? span.requestModel ?? "unknown";
    const excluded = this.configManager.config.excludedModels;
    if (excluded.some((e) => model.toLowerCase().includes(e.toLowerCase()))) {
      this.lastProcessedTimestamp = span.startTimeMs;
      return true;
    }

    return false;
  }

  private async ingestFromTracesDb(sinceOverride?: number): Promise<number> {
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
    for (const span of spans) {
      if (this.shouldSkipSpan(span)) continue;

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
        span.chatSessionId ?? "unknown"
      );

      newCount++;
      this.lastProcessedTimestamp = span.startTimeMs;
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

  dispose(): void {
    this.isDisposed = true;
    this.scheduler.stop();
    this.onDataChanged.dispose();
  }
}
