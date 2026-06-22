import type { TelemetrySource } from "../config";

export type ActiveSource = "database" | "jsonl";

export interface SourceResolverDeps {
  dbExists(): boolean;
  onSwitchToJsonl(): void;
  onRecoverToDb(): void;
}

/**
 * Pure state machine that decides whether to ingest from the traces DB or JSONL.
 *
 * Separated from TracesIngester so failover behaviour can be unit-tested
 * without database or file-system dependencies.
 */
export class TelemetrySourceResolver {
  private telemetrySource: TelemetrySource = "auto";
  private activeSource: ActiveSource = "database";
  private consecutiveEmptyDbPolls: number = 0;
  private lastDbFailoverAtMs: number = 0;

  static readonly FAILOVER_THRESHOLD_POLLS = 12;
  static readonly DB_RECOVERY_PROBE_MS = 60_000;

  setTelemetrySource(source: TelemetrySource): void {
    this.telemetrySource = source;
    if (source === "database") {
      this.activeSource = "database";
      this.consecutiveEmptyDbPolls = 0;
      this.lastDbFailoverAtMs = 0;
    } else if (source === "jsonl") {
      this.activeSource = "jsonl";
    }
  }

  getActiveSource(): ActiveSource {
    return this.activeSource;
  }

  /** Call after a DB poll that returned zero new spans. */
  recordEmptyDbPoll(): void {
    this.consecutiveEmptyDbPolls++;
  }

  /** Call after a DB poll that returned data. */
  recordSuccessfulDbPoll(): void {
    this.consecutiveEmptyDbPolls = 0;
  }

  resolve(deps: SourceResolverDeps, nowMs: number = Date.now()): ActiveSource {
    if (this.telemetrySource === "database") return "database";
    if (this.telemetrySource === "jsonl") return "jsonl";

    if (!deps.dbExists()) {
      if (this.activeSource !== "jsonl") {
        this.activeSource = "jsonl";
        this.lastDbFailoverAtMs = nowMs;
        deps.onSwitchToJsonl();
      }
      return "jsonl";
    }

    if (this.activeSource === "jsonl") {
      const elapsed = nowMs - this.lastDbFailoverAtMs;
      if (elapsed < TelemetrySourceResolver.DB_RECOVERY_PROBE_MS) {
        return "jsonl";
      }
      this.activeSource = "database";
      this.consecutiveEmptyDbPolls = 0;
      deps.onRecoverToDb();
    }

    if (this.consecutiveEmptyDbPolls >= TelemetrySourceResolver.FAILOVER_THRESHOLD_POLLS) {
      this.activeSource = "jsonl";
      this.lastDbFailoverAtMs = nowMs;
      deps.onSwitchToJsonl();
      return "jsonl";
    }

    this.activeSource = "database";
    return "database";
  }
}
