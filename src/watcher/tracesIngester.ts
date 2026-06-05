import * as vscode from "vscode";
import { TracesDbReader, TraceSpan, LogParser } from "../parser";
import { PricingEngine } from "../pricing";
import { CostDatabase } from "../database";
import { TelemetrySource, ConfigManager } from "../config";
import { Logger } from "../logger";

/**
 * Unified data ingester with failover.
 * Primary: agent-traces.db (via sql.js)
 * Fallback: JSONL debug logs (via LogParser)
 *
 * Failover triggers when:
 * - telemetrySource is "jsonl" (forced)
 * - traces DB doesn't exist
 * - traces DB hasn't produced data in >60s of polling
 */
export class TracesIngester implements vscode.Disposable {
  private readonly reader: TracesDbReader;
  private readonly logParser: LogParser;
  private readonly pricing: PricingEngine;
  private readonly database: CostDatabase;
  private readonly configManager: ConfigManager;
  private readonly logger: Logger;
  private pollTimer: NodeJS.Timeout | undefined;
  private lastProcessedTimestamp: number = 0;
  private readonly onDataChanged: vscode.EventEmitter<void>;
  private isDisposed: boolean = false;

  // Failover tracking
  private telemetrySource: TelemetrySource = "auto";
  private activeSource: "database" | "jsonl" = "database";
  private consecutiveEmptyDbPolls: number = 0;
  private static readonly FAILOVER_THRESHOLD_POLLS = 12; // ~60s at 5s interval
  private lastDbFailoverAtMs: number = 0;
  private static readonly DB_RECOVERY_PROBE_MS = 60_000;

  // Adaptive polling (D2)
  private currentIntervalMs: number = 5000;
  private minIntervalMs: number = 5000;
  private maxIntervalMs: number = 60000;

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

    // Recover watermark from persisted data (D3)
    this.lastProcessedTimestamp = database.getMaxTimestamp();
    this.logger.debug(`Recovered watermark: ${this.lastProcessedTimestamp}`);
  }

  /**
   * Set the telemetry source preference (from config).
   */
  setTelemetrySource(source: TelemetrySource): void {
    this.telemetrySource = source;
    if (source === "database") {
      this.activeSource = "database";
      this.consecutiveEmptyDbPolls = 0;
      this.lastDbFailoverAtMs = 0;
    } else if (source === "jsonl") {
      this.activeSource = "jsonl";
    }
    // "auto" will determine on next poll
    this.logger.debug(`Telemetry source set to: ${source}`);
  }

  /**
   * Get the currently active data source.
   */
  getActiveSource(): "database" | "jsonl" {
    return this.activeSource;
  }

  /**
   * Start adaptive polling for new trace data.
   * Uses setTimeout chain with exponential backoff.
   */
  startPolling(minMs?: number, maxMs?: number): void {
    if (minMs !== undefined) { this.minIntervalMs = minMs; }
    if (maxMs !== undefined) { this.maxIntervalMs = maxMs; }
    this.currentIntervalMs = this.minIntervalMs;
    this.scheduleNextPoll();
  }

  /**
   * Update polling bounds (e.g., when config changes).
   */
  updatePollingBounds(minMs: number, maxMs: number): void {
    this.minIntervalMs = minMs;
    this.maxIntervalMs = maxMs;
    // Clamp current interval to new bounds
    this.currentIntervalMs = Math.min(Math.max(this.currentIntervalMs, minMs), maxMs);
  }

  private scheduleNextPoll(): void {
    if (this.isDisposed) { return; }
    this.pollTimer = setTimeout(async () => {
      const count = await this.ingest();
      this.adjustInterval(count);
      this.scheduleNextPoll();
    }, this.currentIntervalMs);
  }

  private adjustInterval(newCount: number): void {
    if (newCount > 0) {
      // Data found — reset to fastest
      this.currentIntervalMs = this.minIntervalMs;
    } else {
      // No data — double interval (capped at max)
      this.currentIntervalMs = Math.min(this.currentIntervalMs * 2, this.maxIntervalMs);
    }
  }

  /**
   * Update the poll interval (e.g., for adaptive polling).
   */
  reschedule(intervalMs: number): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    this.currentIntervalMs = intervalMs;
    this.scheduleNextPoll();
  }

  /**
   * Perform a full ingest of all available trace data.
   */
  async fullIngest(): Promise<number> {
    return this.ingest(0);
  }

  /**
   * Ingest new data since last processed timestamp.
   * Routes to the appropriate source based on failover logic.
   */
  async ingest(sinceOverride?: number): Promise<number> {
    if (this.isDisposed) {
      return 0;
    }

    const source = this.resolveSource();

    if (source === "database") {
      return this.ingestFromTracesDb(sinceOverride);
    } else {
      return this.ingestFromJsonl();
    }
  }

  /**
   * Determine which source to use based on config and failover state.
   */
  private resolveSource(): "database" | "jsonl" {
    if (this.telemetrySource === "database") {
      return "database";
    }
    if (this.telemetrySource === "jsonl") {
      return "jsonl";
    }

    // Auto mode: check if DB is available and producing data
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

  /**
   * Check if a span should be skipped, updating watermark if needed.
   * Returns true if span should be skipped, false if it should be processed.
   */
  private shouldSkipSpan(span: TraceSpan): boolean {
    // Skip if we've already seen this span
    if (span.startTimeMs <= this.lastProcessedTimestamp) {
      return true;
    }

    // D5: Skip zero-token routing calls (e.g., model selection without actual token consumption).
    // These don't generate costs and are not relevant for billing. We still advance the watermark
    // (lastProcessedTimestamp) to avoid re-examining them on restart, assuming clock is monotonic.
    // Note: If system clock moves backward (clock skew), this may skip cost entries. However,
    // the deduplication logic (INSERT OR IGNORE on unique constraint) provides defense in depth
    // if watermark logic has a bug. In practice, clock skew is rare on modern systems with NTP.
    if (span.inputTokens === 0 && span.outputTokens === 0) {
      this.lastProcessedTimestamp = span.startTimeMs;
      return true;
    }

    // Filter excluded models (e.g., gpt-4o-mini code completions)
    // Prefer responseModel because requestModel may be a generic routing model.
    const model = span.responseModel ?? span.requestModel ?? "unknown";
    const excluded = this.configManager.config.excludedModels;
    if (excluded.some((e) => model.toLowerCase().includes(e.toLowerCase()))) {
      this.lastProcessedTimestamp = span.startTimeMs;
      return true;
    }

    return false;
  }

  /**
   * Ingest from the traces DB (primary path).
   * If this fails repeatedly, triggers automatic failover to JSONL (D2: Failover after 12 polls ~60s).
   */
  private async ingestFromTracesDb(sinceOverride?: number): Promise<number> {
    const since = sinceOverride ?? this.lastProcessedTimestamp;

    let spans: TraceSpan[];
    try {
      spans = await this.reader.querySpans(since > 0 ? since : undefined);
    } catch (err) {
      this.logger.error("Failed to query traces DB, will trigger failover if this continues", err);
      this.consecutiveEmptyDbPolls++;
      // After FAILOVER_THRESHOLD_POLLS failures, resolveSource() will switch to JSONL (D2)
      return 0;
    }

    if (spans.length === 0) {
      this.consecutiveEmptyDbPolls++;
      return 0;
    }

    // Reset failover counter on successful data
    this.consecutiveEmptyDbPolls = 0;

    let newCount = 0;

    for (const span of spans) {
      if (this.shouldSkipSpan(span)) {
        continue;
      }

      // Prefer responseModel (actual LLM that ran) over requestModel (may be a routing
      // dispatcher like "copilot-nes-oct" when Copilot auto-selects a model).
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
          model: model,
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

  /**
   * Ingest from JSONL debug logs (fallback path).
   * Used when traces DB is unavailable or fails to produce data for ~60s.
   */
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

      if (sessionTurns.length === 0) {
        continue;
      }

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
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.onDataChanged.dispose();
  }
}
