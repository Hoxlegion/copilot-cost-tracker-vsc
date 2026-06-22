import * as vscode from "vscode";
import { TracesDbReader, TraceSpan, LogParser, AGGREGATE_AGENT_NAME } from "../parser";
import { PricingEngine } from "../pricing";
import { CostWriter, CostMaintenance } from "../database";
import { TelemetrySource, ConfigManager } from "../config";
import { Logger } from "../logger";
import { FileWatcherStrategy } from "./fileWatcherStrategy";
import { TelemetrySourceResolver } from "./telemetrySourceResolver";

type IngesterDatabase = CostWriter & CostMaintenance;

export class TracesIngester implements vscode.Disposable {
  private readonly reader: TracesDbReader;
  private readonly logParser: LogParser;
  private readonly pricing: PricingEngine;
  private readonly database: IngesterDatabase;
  private readonly configManager: ConfigManager;
  private readonly logger: Logger;
  private readonly workspaceId: string;
  private readonly onDataChanged: vscode.EventEmitter<void>;
  private readonly sourceResolver: TelemetrySourceResolver;
  private watcher: FileWatcherStrategy | undefined;
  private isDisposed: boolean = false;

  private lastProcessedTimestamp: number = 0;
  private migrationsApplied: boolean = false;
  private static readonly INGEST_BATCH_SIZE = 5_000;

  readonly onDidDataChange: vscode.Event<void>;

  constructor(
    reader: TracesDbReader,
    logParser: LogParser,
    pricing: PricingEngine,
    database: IngesterDatabase,
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
    this.sourceResolver = new TelemetrySourceResolver();

    this.lastProcessedTimestamp = database.getMaxTimestamp();
    this.logger.debug(`Recovered watermark: ${this.lastProcessedTimestamp}`);
  }

  setTelemetrySource(source: TelemetrySource): void {
    this.sourceResolver.setTelemetrySource(source);
    this.logger.debug(`Telemetry source set to: ${source}`);
  }

  getActiveSource(): "database" | "jsonl" {
    return this.sourceResolver.getActiveSource();
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

    await this.applyDataMigrationsOnce();

    const source = this.sourceResolver.resolve({
      dbExists: () => this.reader.exists(),
      onSwitchToJsonl: () => {
        this.logger.info("Switching to JSONL fallback");
        this.setWatchPath(null);
      },
      onRecoverToDb: () => {
        this.logger.info("Probing traces DB for recovery after JSONL failover");
        this.setWatchPath(this.reader.path);
      },
    });

    let count: number;
    if (source === "database") {
      count = await this.ingestFromTracesDb(sinceOverride);
    } else {
      count = await this.ingestFromJsonl();
    }

    this.syncSessionTitles();

    return count;
  }

  /**
   * Run one-time data migrations that correct previously ingested turns. Idempotent at the
   * database level (guarded by a stored data version); this flag just avoids re-running per poll.
   */
  private async applyDataMigrationsOnce(): Promise<void> {
    if (this.migrationsApplied) return;
    this.migrationsApplied = true;
    try {
      const migrated = this.database.recomputeCacheTokenSemantics((t) => {
        const costUsd = this.pricing.calculateCost(
          t.modelFamily,
          t.inputTokens,
          t.outputTokens,
          t.cachedTokens,
          t.cacheWriteTokens
        );
        return { costUsd, credits: this.pricing.costToCredits(costUsd) };
      });
      if (migrated) {
        await this.database.save();
        this.logger.info("Applied cache-token semantics migration to existing turns");
        if (!this.isDisposed) this.onDataChanged.fire();
      }
    } catch (err) {
      this.logger.warn("Cache-token semantics migration failed (non-fatal)", err);
    }
  }
  private shouldSkipSpan(span: TraceSpan, skipWatermark: boolean = false): boolean {
    if (!skipWatermark && span.startTimeMs <= this.lastProcessedTimestamp) return true;

    if (span.inputTokens === 0 && span.outputTokens === 0) {
      return true;
    }

    // The outer "GitHub Copilot Chat" span is a conversation-level roll-up/duplicate of the
    // actual billed surface spans (e.g. panel/editAgent). It never carries real credits, so
    // skipping it avoids double counting tokens and inflated cost estimates.
    if (span.agentName === AGGREGATE_AGENT_NAME && span.realCredits == null) {
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

    // Telemetry `input_tokens` includes `cached_tokens` (cache reads are a subset of the
    // prompt). Store only the non-cached portion so `inputTokens + cachedTokens` is the full
    // prompt and cached tokens are billed once at the cached rate rather than the input rate.
    const inputTokens = Math.max(0, span.inputTokens - span.cachedTokens);

    let costUsd: number;
    let credits: number;
    let costSource: "real" | "estimated";

    if (span.realCredits == null) {
      // Fall back to token-based estimate
      costUsd = this.pricing.calculateCost(
        model,
        inputTokens,
        span.outputTokens,
        span.cachedTokens,
        span.cacheWriteTokens
      );
      credits = this.pricing.costToCredits(costUsd);
      costSource = "estimated";
    } else {
      // Use actual billing credits recorded by GitHub
      credits = span.realCredits;
      costUsd = credits / 100; // 1 credit = $0.01
      costSource = "real";
    }

    this.database.insertTurn(
      {
        sessionId: span.chatSessionId ?? span.conversationId ?? "unknown",
        timestamp: span.startTimeMs,
        duration: span.endTimeMs - span.startTimeMs,
        agentName: span.agentName ?? "unknown",
        model,
        modelFamily: model,
        inputTokens,
        outputTokens: span.outputTokens,
        cachedTokens: span.cachedTokens,
        cacheWriteTokens: span.cacheWriteTokens,
        totalTokens: inputTokens + span.outputTokens + span.cachedTokens + span.cacheWriteTokens,
        status: span.statusCode === 0 ? "ok" : "error",
        costSource,
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
      this.sourceResolver.recordEmptyDbPoll();
      return 0;
    }

    if (spans.length === 0) {
      this.sourceResolver.recordEmptyDbPoll();
      return 0;
    }

    this.sourceResolver.recordSuccessfulDbPoll();

    // When doing a full re-scan (since=0), skip the watermark check so that
    // existing estimated turns can be upgraded with real credit values.
    const skipWatermark = since === 0;
    const newCount = await this.processSpanBatch(spans, skipWatermark);

    if (newCount > 0 && !this.isDisposed) {
      const realCount = spans.filter(s => s.realCredits != null).length;
      this.logger.debug(`Ingested ${newCount} spans (${realCount} with real credits, ${newCount - realCount} estimated)`);
      this.onDataChanged.fire();
    }
    return newCount;
  }

  private async processSpanBatch(spans: TraceSpan[], skipWatermark: boolean = false): Promise<number> {
    let newCount = 0;
    let maxTimestamp = this.lastProcessedTimestamp;

    this.database.beginTransaction();
    try {
      for (const span of spans) {
        if (this.isDisposed) break;
        if (this.shouldSkipSpan(span, skipWatermark)) continue;

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
        turn.costSource = "estimated";
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
