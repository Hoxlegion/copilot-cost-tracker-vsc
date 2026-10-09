import { describe, expect, it } from "vitest";
import {
  cliRowToTurn,
  cliSessionStatus,
  computeCliUsageRows,
  parseCliSessionLog,
  parseWorkspaceYaml,
  type CliUsageRow,
  type CliUsageTotals,
} from "../src/parser/cliSessionParser";

// Synthetic events in the CLI's on-disk shape. Token and nano AIU numbers come from real sessions;
// no transcript content is used.
const SESSION = "8488d00c-0000-4000-8000-000000000000";
let eventCounter = 0;

function event(type: string, timestamp: string, data: Record<string, unknown> = {}): string {
  eventCounter++;
  return JSON.stringify({ type, data, id: `event-${eventCounter}`, timestamp, parentId: null });
}

interface MetricInput {
  requests: number;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  fresh?: number;
  nano?: number;
}

function metric(m: MetricInput): Record<string, unknown> {
  const cacheRead = m.cacheRead ?? 0;
  const cacheWrite = m.cacheWrite ?? 0;
  return {
    requests: { count: m.requests, cost: 1 },
    usage: { inputTokens: m.input, outputTokens: m.output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, reasoningTokens: 0 },
    ...(m.fresh === undefined ? {} : {
      tokenDetails: {
        input: { tokenCount: m.fresh },
        cache_read: { tokenCount: cacheRead },
        cache_write: { tokenCount: cacheWrite },
        output: { tokenCount: m.output },
      },
    }),
    ...(m.nano === undefined ? {} : { totalNanoAiu: m.nano }),
  };
}

function modelMetrics(models: Record<string, MetricInput>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(models).map(([model, m]) => [model, metric(m)]));
}

function totalNano(models: Record<string, MetricInput>): number {
  return Object.values(models).reduce((sum, m) => sum + (m.nano ?? 0), 0);
}

function shutdown(timestamp: string, models: Record<string, MetricInput>, extra: Record<string, unknown> = {}): string {
  return event("session.shutdown", timestamp, {
    shutdownType: "routine",
    totalNanoAiu: totalNano(models),
    modelMetrics: modelMetrics(models),
    ...extra,
  });
}

function checkpoint(timestamp: string, models: Record<string, MetricInput>, watermarks: Record<string, number>): string {
  return event("session.usage_checkpoint", timestamp, {
    totalNanoAiu: totalNano(models),
    usageAccountingWatermarks: watermarks,
    accountingSnapshot: { modelMetrics: modelMetrics(models) },
  });
}

interface RecordInput {
  model: string;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  fresh?: number;
  nano?: number;
  seq?: number;
  duration?: number;
  byok?: boolean;
}

function record(timestamp: string, r: RecordInput): string {
  const cacheRead = r.cacheRead ?? 0;
  const cacheWrite = r.cacheWrite ?? 0;
  const tokenDetails = r.fresh === undefined ? [] : [
    { tokenType: "input", tokenCount: r.fresh, costPerBatch: 1, batchSize: 1 },
    { tokenType: "cache_read", tokenCount: cacheRead, costPerBatch: 1, batchSize: 1 },
    { tokenType: "output", tokenCount: r.output, costPerBatch: 1, batchSize: 1 },
  ];
  return event("session.usage_record", timestamp, {
    usage: {
      model: r.model,
      provider: { kind: "copilot" },
      inputTokens: r.input,
      outputTokens: r.output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      duration: r.duration ?? 1000,
      isByok: r.byok ?? false,
      initiator: "user",
      aiCreditsStatus: "ok",
      ...(r.nano === undefined ? {} : { copilotUsage: { totalNanoAiu: r.nano, tokenDetails } }),
      ...(r.seq === undefined ? {} : { accounting: { sourceSessionId: SESSION, sequence: r.seq, usageId: `usage-${r.seq}` } }),
    },
  });
}

function start(timestamp: string, copilotVersion = "1.0.78"): string {
  return event("session.start", timestamp, {
    sessionId: SESSION,
    copilotVersion,
    startTime: timestamp,
    context: { cwd: "C:\\src\\repo", gitRoot: "C:\\src\\repo", repository: "org/project/repo" },
  });
}

function resume(timestamp: string, copilotVersion = "1.0.78"): string {
  return event("session.resume", timestamp, { copilotVersion });
}

function assistant(timestamp: string): string {
  return event("assistant.message", timestamp, { content: "not parsed", outputTokens: 999_999 });
}

async function parse(lines: string[]) {
  const log = await parseCliSessionLog(lines);
  const rows = computeCliUsageRows(log);
  return { log, rows, status: cliSessionStatus(log, rows) };
}

function sum(rows: CliUsageRow[], key: Exclude<keyof CliUsageTotals, "nanoKnown">): number {
  return rows.reduce((total, row) => total + row.totals[key], 0);
}

const at = (time: string) => `2026-05-02T${time}.000Z`;

describe("Copilot CLI session parser", () => {
  it("reads a legacy shutdown as one row with GitHub's billed amount", async () => {
    const { log, rows, status } = await parse([
      start(at("10:00:00"), "1.0.71"),
      assistant(at("10:00:05")),
      shutdown(at("10:01:00"), {
        "claude-opus-4.8": { requests: 1, input: 26933, output: 263, cacheWrite: 26931, fresh: 2, nano: 19239412500 },
      }),
    ]);

    expect(status).toBe("ok");
    expect(log).toMatchObject({ sessionId: SESSION, copilotVersion: "1.0.71", startMs: Date.parse(at("10:00:00")), assistantMessages: 1 });
    expect(rows).toEqual([{
      timestamp: Date.parse(at("10:01:00")),
      model: "claude-opus-4.8",
      durationMs: 0,
      totals: { requests: 1, freshInput: 2, cacheRead: 0, cacheWrite: 26931, output: 263, nanoAiu: 19239412500, nanoKnown: true },
    }]);
    expect(cliRowToTurn(rows[0], "651ccb2b")).toMatchObject({
      sessionId: "651ccb2b",
      agentName: "copilot-cli",
      model: "claude-opus-4.8",
      modelFamily: "claude-opus-4.8",
      inputTokens: 2,
      cachedTokens: 0,
      cacheWriteTokens: 26931,
      outputTokens: 263,
      totalTokens: 2 + 263 + 26931,
      costSource: "real",
      source: "cli",
      requestCount: 1,
    });
  });

  it("combines a legacy lifetime with a resumed, session-cumulative lifetime without double counting", async () => {
    const cumulative = { "gpt-5-mini": { requests: 2, input: 26658, output: 161, fresh: 26658, nano: 768515000 } };
    const { rows, status } = await parse([
      start(at("09:00:00"), "1.0.70"),
      assistant(at("09:00:05")),
      shutdown(at("09:05:00"), { "gpt-5-mini": { requests: 1, input: 13222, output: 118, fresh: 13222, nano: 389565000 } }),
      resume(at("10:00:00")),
      record(at("10:00:10"), { model: "gpt-5-mini", input: 13436, output: 43, fresh: 13436, nano: 378950000, seq: 1 }),
      assistant(at("10:00:11")),
      checkpoint(at("10:00:12"), cumulative, { [SESSION]: 1 }),
      shutdown(at("10:05:00"), cumulative, { usageAccountingWatermarks: { [SESSION]: 1 } }),
    ]);

    expect(status).toBe("ok");
    expect(rows.map((r) => r.timestamp)).toEqual([Date.parse(at("09:05:00")), Date.parse(at("10:00:10"))]);
    expect(sum(rows, "nanoAiu")).toBe(768515000);
    expect(sum(rows, "requests")).toBe(2);
    expect(sum(rows, "freshInput")).toBe(26658);
    expect(sum(rows, "output")).toBe(161);
  });

  it("uses per-call records and ignores snapshots they already cover", async () => {
    const totals = { "claude-sonnet-5": { requests: 1, input: 13357, output: 168, cacheRead: 12672, fresh: 685, nano: 90645500 } };
    const { rows, status } = await parse([
      start(at("11:00:00")),
      record(at("11:00:03"), { model: "claude-sonnet-5", input: 13357, output: 168, cacheRead: 12672, fresh: 685, nano: 90645500, seq: 1, duration: 2948 }),
      assistant(at("11:00:04")),
      checkpoint(at("11:00:05"), totals, { [SESSION]: 1 }),
      shutdown(at("11:01:00"), totals, { usageAccountingWatermarks: { [SESSION]: 1 } }),
    ]);

    expect(status).toBe("ok");
    expect(rows).toEqual([{
      timestamp: Date.parse(at("11:00:03")),
      model: "claude-sonnet-5",
      durationMs: 2948,
      totals: { requests: 1, freshInput: 685, cacheRead: 12672, cacheWrite: 0, output: 168, nanoAiu: 90645500, nanoKnown: true },
    }]);
  });

  it("counts a repeated usage record once", async () => {
    const line = record(at("12:00:01"), { model: "gpt-5", input: 100, output: 10, fresh: 100, nano: 5000, seq: 7 });
    const { rows } = await parse([start(at("12:00:00")), line, line]);

    expect(rows).toHaveLength(1);
    expect(sum(rows, "nanoAiu")).toBe(5000);
  });

  it("adds per-lifetime shutdowns written by older CLIs", async () => {
    const { rows } = await parse([
      start(at("08:00:00"), "1.0.4"),
      shutdown(at("08:10:00"), { "gpt-5": { requests: 1, input: 1000, output: 100, fresh: 1000, nano: 100 } }),
      resume(at("08:20:00"), "1.0.4"),
      shutdown(at("08:30:00"), { "gpt-5": { requests: 2, input: 3000, output: 200, fresh: 3000, nano: 250 } }),
    ]);

    expect(rows).toHaveLength(2);
    expect(sum(rows, "requests")).toBe(3);
    expect(sum(rows, "nanoAiu")).toBe(350);
    expect(sum(rows, "freshInput")).toBe(4000);
  });

  it("adds the uncovered remainder of a restored snapshot when records are missing", async () => {
    const totals = { "gpt-5": { requests: 3, input: 3000, output: 300, fresh: 3000, nano: 900 } };
    const { rows } = await parse([
      start(at("13:00:00")),
      record(at("13:00:01"), { model: "gpt-5", input: 1000, output: 100, fresh: 1000, nano: 300, seq: 1 }),
      checkpoint(at("13:00:05"), totals, { [SESSION]: 3 }),
      shutdown(at("13:01:00"), totals, { usageAccountingWatermarks: { [SESSION]: 3 } }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ timestamp: Date.parse(at("13:00:05")), durationMs: 0, totals: { requests: 2, nanoAiu: 600 } });
    expect(sum(rows, "nanoAiu")).toBe(900);
  });

  it("reads per-model usage from provider metrics when a checkpoint has no model metrics", async () => {
    const { rows } = await parse([
      start(at("14:00:00")),
      event("session.usage_checkpoint", at("14:00:10"), {
        totalNanoAiu: 700,
        usageAccountingWatermarks: {},
        providerModelMetrics: [
          { modelId: "gpt-5", metrics: metric({ requests: 1, input: 100, output: 10, fresh: 100, nano: 300 }) },
          { modelId: "gpt-5", metrics: metric({ requests: 1, input: 200, output: 20, fresh: 200, nano: 400 }) },
        ],
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].totals).toMatchObject({ requests: 2, freshInput: 300, output: 30, nanoAiu: 700 });
  });

  it("marks a resumed lifetime that saved no usage as partial", async () => {
    const { rows, status } = await parse([
      start(at("15:00:00"), "1.0.68"),
      assistant(at("15:00:05")),
      shutdown(at("15:05:00"), {
        "claude-sonnet-5": { requests: 2, input: 49527, output: 190, cacheWrite: 49523, fresh: 4, nano: 13828705000 },
      }),
      resume(at("16:00:00"), "1.0.68"),
      assistant(at("16:00:05")),
    ]);

    expect(status).toBe("partial");
    expect(rows).toHaveLength(1);
    expect(sum(rows, "nanoAiu")).toBe(13828705000);
  });

  it("distinguishes sessions without saved usage from sessions without model calls", async () => {
    expect((await parse([start(at("17:00:00")), assistant(at("17:00:05"))])).status).toBe("no_usage");
    expect((await parse([start(at("17:00:00"))])).status).toBe("empty");
  });

  it("ignores a half-written last line and keeps the latest event time", async () => {
    const { log, rows } = await parse([
      start(at("18:00:00")),
      shutdown(at("18:05:00"), { "gpt-5": { requests: 1, input: 10, output: 1, fresh: 10, nano: 42 } }),
      assistant(at("18:06:00")),
      '{"type":"session.shutdown","data":{"modelMetrics":{"gpt-5":',
    ]);

    expect(log.malformedLines).toBe(1);
    expect(log.lastEventMs).toBe(Date.parse(at("18:06:00")));
    expect(rows).toHaveLength(1);
    expect(sum(rows, "nanoAiu")).toBe(42);
  });

  it("flags usage without a billed amount for estimation", async () => {
    const { rows } = await parse([
      start(at("19:00:00")),
      record(at("19:00:01"), { model: "gpt-5", input: 1000, output: 10, cacheRead: 600, cacheWrite: 100, seq: 1 }),
    ]);

    expect(rows[0].totals).toMatchObject({ freshInput: 300, cacheRead: 600, cacheWrite: 100, nanoAiu: 0, nanoKnown: false });
    expect(cliRowToTurn(rows[0], SESSION).costSource).toBe("estimated");

    const legacy = await parse([
      start(at("19:10:00"), "1.0.4"),
      shutdown(at("19:20:00"), { "gpt-5": { requests: 1, input: 500, output: 5 } }),
    ]);
    expect(legacy.rows[0].totals).toMatchObject({ freshInput: 500, nanoKnown: false });
  });

  it("treats bring-your-own-key calls as not billed by GitHub", async () => {
    const { rows } = await parse([
      start(at("20:00:00")),
      record(at("20:00:01"), { model: "my-byok-model", input: 100, output: 10, seq: 1, byok: true }),
    ]);

    expect(rows[0].totals).toMatchObject({ nanoAiu: 0, nanoKnown: true });
    expect(cliRowToTurn(rows[0], SESSION).costSource).toBe("real");
  });

  it("keeps rows unique per timestamp and model", async () => {
    const { rows } = await parse([
      start(at("21:00:00")),
      record(at("21:00:01"), { model: "gpt-5", input: 10, output: 1, fresh: 10, nano: 1, seq: 1 }),
      record(at("21:00:01"), { model: "gpt-5", input: 20, output: 2, fresh: 20, nano: 2, seq: 2 }),
      record(at("21:00:01"), { model: "gpt-5-mini", input: 30, output: 3, fresh: 30, nano: 3, seq: 3 }),
    ]);

    const base = Date.parse(at("21:00:01"));
    expect(rows.map((r) => [r.model, r.timestamp])).toEqual([
      ["gpt-5", base],
      ["gpt-5", base + 1],
      ["gpt-5-mini", base],
    ]);
  });

  it("tracks the session context across context changes", async () => {
    const { log } = await parse([
      start(at("22:00:00")),
      event("session.context_changed", at("22:00:05"), { cwd: "C:\\src\\other", gitRoot: "C:\\src\\other" }),
    ]);

    expect(log.context).toEqual({ cwd: "C:\\src\\other", gitRoot: "C:\\src\\other", repository: "org/project/repo" });
  });
});

describe("parseWorkspaceYaml", () => {
  it("reads flat key-value pairs and strips quotes", () => {
    const yaml = [
      "id: 8488d00c",
      'name: "Fix the build"',
      "repository: org/project/repo",
      "git_root: 'C:\\src\\repo'",
      "summary:",
      "cwd: C:\\src\\repo\\app",
    ].join("\r\n");

    expect(parseWorkspaceYaml(yaml)).toEqual({
      id: "8488d00c",
      name: "Fix the build",
      repository: "org/project/repo",
      git_root: "C:\\src\\repo",
      cwd: "C:\\src\\repo\\app",
    });
  });
});
