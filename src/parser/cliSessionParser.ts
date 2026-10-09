import { CLI_AGENT_NAME, type ParsedTurn } from "./types";

/**
 * Parser for GitHub Copilot CLI session logs (`<COPILOT_HOME>/session-state/<id>/events.jsonl`).
 *
 * Usage only reaches disk through three persisted event types:
 *  - `session.usage_record`: one durable receipt per model call (newer CLIs), with GitHub's billed nano AIU;
 *  - `session.usage_checkpoint`: session-cumulative accounting written after each turn (newer CLIs);
 *  - `session.shutdown`: accounting at process exit. Older CLIs report it per process lifetime, newer
 *    CLIs restore accounting on resume and report it session-cumulative (they add watermarks).
 * Records give per-call rows; snapshots only contribute the usage that no record covers (e.g. lifetimes
 * written by older CLIs), so nothing is counted twice.
 */

/** Integer token/credit totals from the CLI's own accounting. */
export interface CliUsageTotals {
  requests: number;
  /** Non-cached input tokens. */
  freshInput: number;
  cacheRead: number;
  cacheWrite: number;
  /** Output tokens, reasoning included. */
  output: number;
  /** GitHub billing units; credits = nanoAiu / 1e9. */
  nanoAiu: number;
  /** False when the CLI reported no billing amount, so credits must be estimated. */
  nanoKnown: boolean;
}

export interface CliUsageRecordEvent {
  kind: "record";
  timestamp: number;
  key: string;
  model: string;
  totals: CliUsageTotals;
  durationMs: number;
}

export interface CliUsageSnapshotEvent {
  kind: "snapshot";
  timestamp: number;
  /** Index of the process lifetime (session.start / session.resume) that wrote it. */
  lifetime: number;
  /** True when the snapshot is session-cumulative across lifetimes. */
  restored: boolean;
  models: Map<string, CliUsageTotals>;
}

export type CliUsageEvent = CliUsageRecordEvent | CliUsageSnapshotEvent;

export interface CliSessionContext {
  cwd: string | null;
  gitRoot: string | null;
  repository: string | null;
}

export interface CliSessionLog {
  sessionId: string | null;
  copilotVersion: string | null;
  startMs: number | null;
  lastEventMs: number;
  context: CliSessionContext;
  assistantMessages: number;
  /** Assistant messages after the last usage snapshot. */
  messagesAfterLastSnapshot: number;
  recordCount: number;
  usage: CliUsageEvent[];
  malformedLines: number;
}

export interface CliUsageRow {
  timestamp: number;
  model: string;
  totals: CliUsageTotals;
  durationMs: number;
}

export type CliSessionUsageStatus = "ok" | "partial" | "no_usage" | "empty";

const TYPE_PREFIX = /^\{"type":"([^"]+)"/;
const TAIL_TIMESTAMP = /"timestamp":"([^"]+)"/g;
const PARSED_TYPES = new Set([
  "session.start",
  "session.resume",
  "session.context_changed",
  "session.usage_record",
  "session.usage_checkpoint",
  "session.shutdown",
]);

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Top-level event timestamp from the end of a raw line, without parsing large payloads. */
function tailTimestamp(line: string): number | null {
  let last: string | null = null;
  for (const match of line.slice(-240).matchAll(TAIL_TIMESTAMP)) last = match[1];
  return last === null ? null : parseTime(last);
}

function zeroTotals(): CliUsageTotals {
  return { requests: 0, freshInput: 0, cacheRead: 0, cacheWrite: 0, output: 0, nanoAiu: 0, nanoKnown: true };
}

function totalsFromMetric(metric: JsonObject): CliUsageTotals {
  const usage = asObject(metric.usage) ?? {};
  const details = asObject(metric.tokenDetails) ?? {};
  const detail = (name: string): number | null => {
    const entry = asObject(details[name]);
    return entry && entry.tokenCount !== undefined ? count(entry.tokenCount) : null;
  };
  const cacheRead = usage.cacheReadTokens !== undefined ? count(usage.cacheReadTokens) : detail("cache_read") ?? 0;
  const cacheWrite = usage.cacheWriteTokens !== undefined ? count(usage.cacheWriteTokens) : detail("cache_write") ?? 0;
  // `inputTokens` includes cache reads and writes; tokenDetails.input is the billed fresh input.
  const freshInput = detail("input") ?? Math.max(0, count(usage.inputTokens) - cacheRead - cacheWrite);
  const nanoKnown = typeof metric.totalNanoAiu === "number" && Number.isFinite(metric.totalNanoAiu);
  return {
    requests: count(asObject(metric.requests)?.count),
    freshInput,
    cacheRead,
    cacheWrite,
    output: count(usage.outputTokens),
    nanoAiu: nanoKnown ? count(metric.totalNanoAiu) : 0,
    nanoKnown,
  };
}

function totalsFromRecord(usage: JsonObject): CliUsageTotals {
  const copilotUsage = asObject(usage.copilotUsage);
  const details = Array.isArray(copilotUsage?.tokenDetails) ? copilotUsage.tokenDetails : [];
  const cacheRead = count(usage.cacheReadTokens);
  const cacheWrite = count(usage.cacheWriteTokens);
  const freshDetails = details.map(asObject).filter((d): d is JsonObject => d?.tokenType === "input");
  const freshInput = freshDetails.length > 0
    ? freshDetails.reduce((sum, d) => sum + count(d.tokenCount), 0)
    : Math.max(0, count(usage.inputTokens) - cacheRead - cacheWrite);
  // Bring-your-own-key calls are not billed by GitHub.
  const byok = usage.isByok === true;
  const nano = copilotUsage?.totalNanoAiu;
  const nanoKnown = byok || (typeof nano === "number" && Number.isFinite(nano));
  return {
    requests: 1,
    freshInput,
    cacheRead,
    cacheWrite,
    output: count(usage.outputTokens),
    nanoAiu: byok || !nanoKnown ? 0 : count(nano),
    nanoKnown,
  };
}

function snapshotModels(data: JsonObject): Map<string, CliUsageTotals> {
  const models = new Map<string, CliUsageTotals>();
  const metrics = asObject(data.modelMetrics) ?? asObject(asObject(data.accountingSnapshot)?.modelMetrics);
  if (metrics && Object.keys(metrics).length > 0) {
    for (const [model, metric] of Object.entries(metrics)) {
      const entry = asObject(metric);
      if (entry) models.set(model, totalsFromMetric(entry));
    }
    return models;
  }
  // Checkpoints may only carry provider-attributed metrics; one model can appear per provider.
  for (const item of Array.isArray(data.providerModelMetrics) ? data.providerModelMetrics : []) {
    const entry = asObject(item);
    const metric = asObject(entry?.metrics);
    if (!entry || !metric) continue;
    const model = text(entry.modelId) ?? "unknown";
    models.set(model, addTotals(models.get(model) ?? zeroTotals(), totalsFromMetric(metric)));
  }
  return models;
}

function addTotals(a: CliUsageTotals, b: CliUsageTotals): CliUsageTotals {
  return {
    requests: a.requests + b.requests,
    freshInput: a.freshInput + b.freshInput,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
    nanoAiu: a.nanoAiu + b.nanoAiu,
    nanoKnown: a.nanoKnown && b.nanoKnown,
  };
}

/** Component-wise `max(0, a - b)`; keeps a's nanoKnown. */
function subtractTotals(a: CliUsageTotals, b: CliUsageTotals): CliUsageTotals {
  return {
    requests: Math.max(0, a.requests - b.requests),
    freshInput: Math.max(0, a.freshInput - b.freshInput),
    cacheRead: Math.max(0, a.cacheRead - b.cacheRead),
    cacheWrite: Math.max(0, a.cacheWrite - b.cacheWrite),
    output: Math.max(0, a.output - b.output),
    nanoAiu: Math.max(0, a.nanoAiu - b.nanoAiu),
    nanoKnown: a.nanoKnown,
  };
}

function maxTotals(a: CliUsageTotals, b: CliUsageTotals): CliUsageTotals {
  return {
    requests: Math.max(a.requests, b.requests),
    freshInput: Math.max(a.freshInput, b.freshInput),
    cacheRead: Math.max(a.cacheRead, b.cacheRead),
    cacheWrite: Math.max(a.cacheWrite, b.cacheWrite),
    output: Math.max(a.output, b.output),
    nanoAiu: Math.max(a.nanoAiu, b.nanoAiu),
    nanoKnown: a.nanoKnown && b.nanoKnown,
  };
}

function isEmptyUsage(t: CliUsageTotals): boolean {
  return t.requests === 0 && t.freshInput === 0 && t.cacheRead === 0 && t.cacheWrite === 0 && t.output === 0 && t.nanoAiu === 0;
}

function applyContext(target: CliSessionContext, value: unknown): void {
  const context = asObject(value);
  if (!context) return;
  target.cwd = text(context.cwd) ?? target.cwd;
  target.gitRoot = text(context.gitRoot) ?? target.gitRoot;
  target.repository = text(context.repository) ?? target.repository;
}

/** Parse a session log line by line. Large payloads (tool output, messages) are never JSON-parsed. */
export async function parseCliSessionLog(lines: AsyncIterable<string> | Iterable<string>): Promise<CliSessionLog> {
  const log: CliSessionLog = {
    sessionId: null,
    copilotVersion: null,
    startMs: null,
    lastEventMs: 0,
    context: { cwd: null, gitRoot: null, repository: null },
    assistantMessages: 0,
    messagesAfterLastSnapshot: 0,
    recordCount: 0,
    usage: [],
    malformedLines: 0,
  };
  let lifetime = -1;

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const type = TYPE_PREFIX.exec(line.slice(0, 120))?.[1];
    if (type !== undefined && !PARSED_TYPES.has(type)) {
      const ts = tailTimestamp(line);
      if (ts !== null && ts > log.lastEventMs) log.lastEventMs = ts;
      if (type === "assistant.message") {
        log.assistantMessages++;
        log.messagesAfterLastSnapshot++;
      }
      continue;
    }

    let event: JsonObject | null;
    try {
      event = asObject(JSON.parse(line));
    } catch {
      // Typically the last line while the CLI is still writing it.
      log.malformedLines++;
      continue;
    }
    if (!event) continue;

    const eventType = typeof event.type === "string" ? event.type : "";
    const timestamp = parseTime(event.timestamp);
    if (timestamp !== null && timestamp > log.lastEventMs) log.lastEventMs = timestamp;
    const data = asObject(event.data) ?? {};

    switch (eventType) {
      case "assistant.message":
        // Only reached when the type prefix could not be read cheaply.
        log.assistantMessages++;
        log.messagesAfterLastSnapshot++;
        break;
      case "session.start":
        lifetime++;
        log.sessionId ??= text(data.sessionId);
        log.copilotVersion = text(data.copilotVersion) ?? log.copilotVersion;
        log.startMs ??= parseTime(data.startTime) ?? timestamp;
        applyContext(log.context, data.context);
        break;
      case "session.resume":
        lifetime++;
        log.copilotVersion = text(data.copilotVersion) ?? log.copilotVersion;
        applyContext(log.context, data.context);
        break;
      case "session.context_changed":
        applyContext(log.context, data);
        break;
      case "session.usage_record": {
        const usage = asObject(data.usage);
        const model = text(usage?.model);
        if (!usage || !model || timestamp === null) break;
        const accounting = asObject(usage.accounting);
        const sequence = accounting?.sequence;
        const key = typeof sequence === "number"
          ? `${text(accounting?.sourceSessionId) ?? ""}:${sequence}`
          : text(accounting?.usageId) ?? text(usage.apiCallId) ?? text(event.id) ?? `${timestamp}:${model}`;
        log.recordCount++;
        log.usage.push({ kind: "record", timestamp, key, model, totals: totalsFromRecord(usage), durationMs: count(usage.duration) });
        break;
      }
      case "session.usage_checkpoint":
      case "session.shutdown":
        if (timestamp === null) break;
        log.messagesAfterLastSnapshot = 0;
        log.usage.push({
          kind: "snapshot",
          timestamp,
          lifetime: Math.max(lifetime, 0),
          restored: data.usageAccountingWatermarks !== undefined || data.accountingSnapshot !== undefined,
          models: snapshotModels(data),
        });
        break;
    }
  }
  return log;
}

/**
 * Turn usage events into billable rows: one per usage record, plus snapshot rows for usage that no
 * record covers. The rows always add up to the session's latest accounting, whatever mix of
 * records, checkpoints, shutdowns and resumes the log contains.
 */
export function computeCliUsageRows(log: CliSessionLog): CliUsageRow[] {
  const rows: CliUsageRow[] = [];
  const seenRecords = new Set<string>();
  const recorded = new Map<string, CliUsageTotals>();
  const uncovered = new Map<string, CliUsageTotals>();
  let cumulative = new Map<string, CliUsageTotals>();
  let lifetimeBase = new Map<string, CliUsageTotals>();
  let currentLifetime = -1;

  for (const event of log.usage) {
    if (event.kind === "record") {
      if (seenRecords.has(event.key)) continue;
      seenRecords.add(event.key);
      recorded.set(event.model, addTotals(recorded.get(event.model) ?? zeroTotals(), event.totals));
      if (!isEmptyUsage(event.totals)) {
        rows.push({ timestamp: event.timestamp, model: event.model, totals: event.totals, durationMs: event.durationMs });
      }
      continue;
    }

    if (event.lifetime !== currentLifetime) {
      // Legacy snapshots restart at zero in every process lifetime.
      lifetimeBase = cumulative;
      currentLifetime = event.lifetime;
    }
    const snapshot = new Map(event.restored ? [] : lifetimeBase);
    for (const [model, totals] of event.models) {
      snapshot.set(model, event.restored ? totals : addTotals(snapshot.get(model) ?? zeroTotals(), totals));
    }

    for (const [model, totals] of snapshot) {
      const now = subtractTotals(totals, recorded.get(model) ?? zeroTotals());
      const before = uncovered.get(model) ?? zeroTotals();
      const delta = subtractTotals(now, before);
      if (!isEmptyUsage(delta)) {
        rows.push({ timestamp: event.timestamp, model, totals: delta, durationMs: 0 });
      }
      uncovered.set(model, maxTotals(before, now));
    }
    cumulative = snapshot;
  }

  return withUniqueTimestamps(rows);
}

/** Rows must be unique per (timestamp, model); parallel calls can finish in the same millisecond. */
function withUniqueTimestamps(rows: CliUsageRow[]): CliUsageRow[] {
  const used = new Set<string>();
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.timestamp - b.row.timestamp || a.index - b.index)
    .map(({ row }) => {
      let timestamp = row.timestamp;
      while (used.has(`${timestamp}|${row.model}`)) timestamp++;
      used.add(`${timestamp}|${row.model}`);
      return timestamp === row.timestamp ? row : { ...row, timestamp };
    });
}

export function cliSessionStatus(log: CliSessionLog, rows: CliUsageRow[]): CliSessionUsageStatus {
  if (rows.length === 0) return log.assistantMessages > 0 ? "no_usage" : "empty";
  // Without per-call records, replies after the last snapshot were never accounted on disk.
  return log.recordCount === 0 && log.messagesAfterLastSnapshot > 0 ? "partial" : "ok";
}

export function cliRowToTurn(row: CliUsageRow, sessionId: string): ParsedTurn {
  const t = row.totals;
  return {
    sessionId,
    timestamp: row.timestamp,
    duration: row.durationMs,
    agentName: CLI_AGENT_NAME,
    model: row.model,
    modelFamily: row.model,
    inputTokens: t.freshInput,
    outputTokens: t.output,
    cachedTokens: t.cacheRead,
    cacheWriteTokens: t.cacheWrite,
    totalTokens: t.freshInput + t.output + t.cacheRead + t.cacheWrite,
    status: "ok",
    costSource: t.nanoKnown ? "real" : "estimated",
    source: "cli",
    requestCount: t.requests,
  };
}

/** Minimal `key: value` reader for the CLI's flat workspace.yaml. */
export function parseWorkspaceYaml(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(line);
    if (!match || match[2] === "") continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}
