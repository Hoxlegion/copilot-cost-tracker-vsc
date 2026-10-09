import * as vscode from "vscode";
import { TracesDbReader, TraceSpan, LogParser, AGGREGATE_AGENT_NAME } from "../parser";
import { PricingEngine } from "../pricing";
import { CostWriter, CostMaintenance } from "../database";
import { TelemetrySource, ConfigManager } from "../config";
import { Logger } from "../logger";
import { FileWatcherStrategy } from "./fileWatcherStrategy";
import { TelemetrySourceResolver } from "./telemetrySourceResolver";
import type { CliIngester } from "./cliIngester";

type IngesterDatabase = CostWriter & CostMaintenance;

export interface TracesIngesterOptions {
  /** Spans read and written per transaction. */
  batchSize?: number;
  /** How far before the watermark incremental passes re-read to catch spans that were written late. */
  overlapMs?: number;
  /** Copilot CLI source, ingested after Copilot Chat in the same serialized pass. */
  cliIngester?: Pick<CliIngester, "ingest">;
}

interface PassTotals {
  spansRead: number;
  newSpans: number;
  written: number;
  changed: number;
  realCredits: number;
  batches: number;
}

const DEFAULT_BATCH_SIZE = 1_000;
const DEFAULT_WATERMARK_OVERLAP_MS = 15 * 60_000;

export class TracesIngester implements vscode.Disposable {
  private readonly reader: TracesDbReader;
  private readonly logParser: LogParser;
  private readonly pricing: PricingEngine;
  private readonly database: IngesterDatabase;
  private readonly configManager: ConfigManager;
  private readonly logger: Logger;
  private readonly workspaceId: string;
  private readonly batchSize: number;
  private readonly overlapMs: number;
  private readonly onDataChanged: vscode.EventEmitter<void>;
  private readonly sourceResolver: TelemetrySourceResolver;
  private readonly cliIngester: Pick<CliIngester, "ingest"> | undefined;
  private watcher: FileWatcherStrategy | undefined;
  private isDisposed: boolean = false;

  private lastProcessedTimestamp: number = 0;
  private migrationsApplied: boolean = false;
  private ongoingIngest: Promise<number> | null = null;

  readonly onDidDataChange: vscode.Event<void>;

  constructor(
    reader: TracesDbReader,
    logParser: LogParser,
    pricing: PricingEngine,
    database: IngesterDatabase,
    configManager: ConfigManager,
    logger: Logger,
    workspaceId: string = "unknown",
    options: TracesIngesterOptions = {},
  ) {
    this.reader = reader;
    this.logParser = logParser;
    this.pricing = pricing;
    this.database = database;
    this.configManager = configManager;
    this.logger = logger;
    this.workspaceId = workspaceId;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.overlapMs = options.overlapMs ?? DEFAULT_WATERMARK_OVERLAP_MS;
    this.cliIngester = options.cliIngester;
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

  ingest(sinceOverride?: number): Promise<number> {
    if (this.isDisposed) return Promise.resolve(0);

    if (this.ongoingIngest) {
      if (sinceOverride === undefined) {
        this.logger.warn("Ingest already in progress, skipping concurrent invocation");
        return Promise.resolve(0);
      }
      return this.ongoingIngest.then(
        () => this.ingest(sinceOverride),
        () => this.ingest(sinceOverride),
      );
    }

    const run = this.runIngest(sinceOverride);
    const tracked = run.finally(() => {
      if (this.ongoingIngest === tracked) this.ongoingIngest = null;
    });
    this.ongoingIngest = tracked;
    return tracked;
  }

  private async runIngest(sinceOverride?: number): Promise<number> {
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

    count += await this.ingestFromCli(sinceOverride === 0);

    this.syncSessionTitles();

    return count;
  }

  private async ingestFromCli(force: boolean): Promise<number> {
    if (!this.cliIngester || this.isDisposed) return 0;
    try {
      const { sessions, turns } = await this.cliIngester.ingest({ force });
      if (sessions > 0 && !this.isDisposed) {
        this.onDataChanged.fire();
      }
      return turns;
    } catch (err) {
      this.logger.error("Failed to ingest Copilot CLI session logs", err);
      return 0;
    }
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
  private shouldSkipSpan(span: TraceSpan, lowerBound: number | undefined): boolean {
    if (lowerBound !== undefined && span.startTimeMs <= lowerBound) return true;

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

  /** Returns true when the turn was inserted or upgraded, false for an unchanged duplicate. */
  private insertSpanAsTurn(span: TraceSpan): boolean {
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

    return this.database.insertTurn(
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
      // Prefer the session's real repo (works across multiple VS Code windows
      // sharing the global traces DB); fall back to this window's workspace.
      span.workspaceRepo ?? this.workspaceId
    );
  }

  private async ingestFromTracesDb(sinceOverride?: number): Promise<number> {
    if (this.isDisposed) return 0;

    const passWatermark = this.lastProcessedTimestamp;
    const since = sinceOverride ?? passWatermark;
    // A full re-scan (since 0) reads everything so estimated turns can be upgraded to real
    // credits. Other passes re-read an overlap window: spans are written when they end, so one
    // can land after later-starting spans already advanced the watermark. Upserts are idempotent.
    const lowerBound = since === 0
      ? undefined
      : Math.max(sinceOverride ?? Number.NEGATIVE_INFINITY, passWatermark - this.overlapMs);
    const queryBound = lowerBound !== undefined && lowerBound > 0 ? lowerBound : undefined;
    // A poll is empty when nothing newer than the pre-overlap bound exists, as before the overlap.
    const pollBound = since > 0 ? since : undefined;

    const totals: PassTotals = { spansRead: 0, newSpans: 0, written: 0, changed: 0, realCredits: 0, batches: 0 };
    try {
      for await (const batch of this.reader.iterateSpanBatches(queryBound, this.batchSize)) {
        if (this.isDisposed || !this.writeSpanBatch(batch, queryBound, pollBound, totals)) break;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } catch (err) {
      if (this.isDisposed) return totals.changed;
      if (totals.spansRead === 0) {
        this.logger.error("Failed to query traces DB, will trigger failover if this continues", err);
        this.sourceResolver.recordEmptyDbPoll();
        return 0;
      }
      this.logger.error("Failed while reading traces DB batches, keeping earlier batches", err);
    }
    if (this.isDisposed) return totals.changed;

    if (totals.newSpans === 0) {
      this.sourceResolver.recordEmptyDbPoll();
    } else {
      this.sourceResolver.recordSuccessfulDbPoll();
    }

    const refresh = this.reader.getLastRefresh();
    this.logger.debug(
      `Traces pass: ${totals.spansRead} spans read, ${totals.written} written, ${totals.changed} changed `
      + `(${totals.realCredits} with real credits) in ${totals.batches} batches; snapshot `
      + (refresh ? `${refresh.mode} (${refresh.bytesRead} bytes, ${refresh.durationMs.toFixed(1)} ms)` : "unavailable"),
    );
    if (totals.changed > 0) {
      this.onDataChanged.fire();
    }
    return totals.changed;
  }

  /** Writes one batch in its own transaction; returns false when the batch had to be rolled back. */
  private writeSpanBatch(batch: TraceSpan[], lowerBound: number | undefined, pollBound: number | undefined, totals: PassTotals): boolean {
    totals.spansRead += batch.length;
    let maxWritten = this.lastProcessedTimestamp;
    let written = 0;
    let changed = 0;
    let realCredits = 0;

    this.database.beginTransaction();
    try {
      for (const span of batch) {
        if (pollBound === undefined || span.startTimeMs > pollBound) totals.newSpans++;
        if (this.shouldSkipSpan(span, lowerBound)) continue;

        written++;
        if (this.insertSpanAsTurn(span)) {
          changed++;
          if (span.realCredits != null) realCredits++;
        }
        if (span.startTimeMs > maxWritten) {
          maxWritten = span.startTimeMs;
        }
      }
      this.database.commitTransaction();
    } catch (err) {
      this.database.rollbackTransaction();
      this.logger.error("Failed during batch insert, rolling back transaction", err);
      return false;
    }

    // Only advance the watermark when spans were actually written. Advancing past
    // filtered/skipped spans (e.g. excluded models) would permanently hide those
    // turns if the user later changes their settings.
    if (written > 0) {
      this.lastProcessedTimestamp = maxWritten;
    }
    totals.written += written;
    totals.changed += changed;
    totals.realCredits += realCredits;
    totals.batches++;
    return true;
  }

  private async ingestFromJsonl(): Promise<number> {
    let sessions;
    try {
      sessions = await this.logParser.parseAllSessions();
    } catch (err) {
      this.logger.error("Failed to parse JSONL sessions (fallback source)", err);
      return 0;
    }

    let newTurns = 0;
    this.database.beginTransaction();
    try {
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
          if (this.database.insertTurn(turn, costUsd, credits, session.workspace ?? "unknown")) {
            newTurns++;
          }
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

      this.database.commitTransaction();
    } catch (err) {
      this.database.rollbackTransaction();
      this.logger.error("Failed during JSONL batch insert, rolling back transaction", err);
      return 0;
    }

    // Persisted by the periodic, change-gated save; turns are re-ingestable until then.
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
