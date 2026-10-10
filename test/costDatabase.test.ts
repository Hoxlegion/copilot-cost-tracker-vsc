import * as fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";
import { CostDatabase, setWasmPath } from "../src/database/costDatabase";
import type { CliSessionInfo, CliSourceState, CostedTurn } from "../src/database/types";
import type { ParsedTurn } from "../src/parser/types";

function turn(overrides: Partial<ParsedTurn> = {}): ParsedTurn {
  return {
    sessionId: "session-1",
    timestamp: 1_000,
    duration: 100,
    agentName: "panel/editAgent",
    model: "gpt-5",
    modelFamily: "gpt-5",
    inputTokens: 10,
    outputTokens: 2,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 12,
    status: "ok",
    costSource: "estimated",
    ...overrides,
  };
}

describe("CostDatabase persistence", () => {
  let storageDir: string;
  let database: CostDatabase;

  beforeEach(async () => {
    setWasmPath(require.resolve("sql.js/dist/sql-wasm.wasm"));
    storageDir = await mkdtemp(join(tmpdir(), "cost-db-"));
    database = new CostDatabase(storageDir);
    await database.initialize();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    database.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  it("persists a new database once and skips exports while nothing changes", async () => {
    const writeFile = vi.spyOn(fs.promises, "writeFile");

    await database.save();
    await database.save();

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(join(storageDir, "copilot-costs.db"))).toBe(true);
  });

  it("treats re-ingesting an identical turn as a no-op", async () => {
    await database.save();
    const writeFile = vi.spyOn(fs.promises, "writeFile");

    expect(database.insertTurn(turn(), 0.01, 1, "workspace")).toBe(true);
    await database.save();
    expect(database.insertTurn(turn(), 0.01, 1, "workspace")).toBe(false);
    await database.save();

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(database.getAllTurns()).toHaveLength(1);
  });

  it("counts an upgrade to real credits and a repo label as changes without duplicating the turn", () => {
    database.insertTurn(turn(), 0.5, 50, "workspace");

    expect(database.insertTurn(turn({ costSource: "real" }), 0.02, 2, "workspace")).toBe(true);
    expect(database.insertTurn(turn({ costSource: "real" }), 0.03, 3, "workspace")).toBe(true);
    expect(database.insertTurn(turn({ costSource: "real" }), 0.03, 3, "workspace")).toBe(false);
    expect(database.insertTurn(turn({ costSource: "real" }), 0.03, 3, "Org/Repo")).toBe(true);
    expect(database.insertTurn(turn(), 0.5, 50, "other-workspace")).toBe(false);
    expect(database.insertTurn(turn(), 0.5, 50, "Another/Repo")).toBe(true);

    expect(database.getAllTurns()).toEqual([
      expect.objectContaining({ credits: 3, costSource: "real", workspace: "Another/Repo" }),
    ]);
  });

  it("refreshes a span's model without duplicating it or replacing a known agent with unknown", () => {
    const original = turn({ spanId: "shared-span", costSource: "real" });
    expect(database.insertTurn(original, 0.01, 1, "Org/Repo")).toBe(true);
    expect(database.insertTurn({ ...original, agentName: "unknown" }, 0.01, 1, "Org/Repo")).toBe(false);
    expect(database.insertTurn({ ...original, model: "claude-sonnet-4.6", modelFamily: "claude-sonnet-4.6" }, 0.02, 2, "Org/Repo"))
      .toBe(true);
    expect(database.getAllTurns()).toEqual([
      expect.objectContaining({ model: "claude-sonnet-4.6", agentName: "panel/editAgent", credits: 2 }),
    ]);
  });

  it("keeps changes dirty when writing the export fails", async () => {
    database.insertTurn(turn(), 0.01, 1, "workspace");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const writeFile = vi.spyOn(fs.promises, "writeFile").mockRejectedValueOnce(new Error("disk full"));

    await database.save();
    await database.save();
    await database.save();

    expect(writeFile).toHaveBeenCalledTimes(2);
    const reopened = new CostDatabase(storageDir);
    await reopened.initialize();
    expect(reopened.getAllTurns()).toHaveLength(1);
    reopened.close();
  });

  it("loads a saved database without marking it dirty", async () => {
    database.insertTurn(turn(), 0.01, 1, "workspace");
    database.close();
    const filePath = join(storageDir, "copilot-costs.db");
    const persisted = fs.statSync(filePath, { bigint: true });
    const writeFile = vi.spyOn(fs.promises, "writeFile");

    database = new CostDatabase(storageDir);
    await database.initialize();
    await database.save();
    database.close();

    expect(writeFile).not.toHaveBeenCalled();
    expect(fs.statSync(filePath, { bigint: true }).mtimeNs).toBe(persisted.mtimeNs);
  });

  it("persists schema migrations applied while loading an older file", async () => {
    database.close();
    const SQL = await initSqlJs();
    const legacy = new SQL.Database();
    legacy.run(`CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY, workspace TEXT NOT NULL, start_timestamp INTEGER NOT NULL,
      last_timestamp INTEGER NOT NULL, copilot_version TEXT, vscode_version TEXT, processed_at INTEGER NOT NULL
    )`);
    fs.writeFileSync(join(storageDir, "copilot-costs.db"), legacy.export());
    legacy.close();
    const writeFile = vi.spyOn(fs.promises, "writeFile");

    database = new CostDatabase(storageDir);
    await database.initialize();
    await database.save();

    expect(writeFile).toHaveBeenCalledTimes(1);
  });
});

describe("CostDatabase with Copilot CLI rows", () => {
  let storageDir: string;
  let database: CostDatabase;

  const cliState = (sessionId: string): CliSourceState => ({
    sessionId, filePath: `/cli/${sessionId}/events.jsonl`, size: 10, mtimeMs: 20, status: "ok", lastEventMs: 9_000,
  });
  const cliInfo = (overrides: Partial<CliSessionInfo> = {}): CliSessionInfo => ({
    workspace: "Org/Repo", startTimestamp: 5_000, lastTimestamp: 5_000, copilotVersion: "1.0.78", title: "Run tests", ...overrides,
  });
  const cliRow = (overrides: Partial<ParsedTurn> = {}, credits = 5): CostedTurn => ({
    turn: turn({ timestamp: 5_000, agentName: "copilot-cli", costSource: "real", source: "cli", requestCount: 3, ...overrides }),
    costUsd: credits / 100,
    credits,
    workspace: "Org/Repo",
  });

  beforeEach(async () => {
    setWasmPath(require.resolve("sql.js/dist/sql-wasm.wasm"));
    storageDir = await mkdtemp(join(tmpdir(), "cost-db-cli-"));
    database = new CostDatabase(storageDir);
    await database.initialize();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    database.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  it("upgrades a 0.7 database and backfills span identities without duplicating existing usage", async () => {
    database.close();
    const SQL = await initSqlJs();
    const legacy = new SQL.Database();
    legacy.run(`CREATE TABLE turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, timestamp INTEGER NOT NULL,
      duration INTEGER NOT NULL, agent_name TEXT NOT NULL DEFAULT 'unknown', model TEXT NOT NULL,
      model_family TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
      cached_tokens INTEGER NOT NULL, cache_write_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL,
      cost_usd REAL NOT NULL, credits REAL NOT NULL, workspace TEXT NOT NULL, status TEXT NOT NULL,
      cost_source TEXT NOT NULL DEFAULT 'estimated', UNIQUE(session_id, timestamp, model)
    )`);
    legacy.run(`INSERT INTO turns (session_id, timestamp, duration, model, model_family, input_tokens, output_tokens,
      cached_tokens, total_tokens, cost_usd, credits, workspace, status)
      VALUES ('chat-1', 1000, 100, 'gpt-5', 'gpt-5', 10, 2, 0, 12, 0.01, 1, 'Org/Repo', 'ok')`);
    fs.writeFileSync(join(storageDir, "copilot-costs.db"), legacy.export());
    legacy.close();

    database = new CostDatabase(storageDir);
    await database.initialize();

    expect(database.getAllTurns()).toEqual([expect.objectContaining({ sessionId: "chat-1", source: "chat", requestCount: 1 })]);
    expect(database.getCliSourceStates().size).toBe(0);
    expect(database.getCostSince(0, undefined, "cli")).toMatchObject({ credits: 0, turns: 0 });
    expect(database.didRecoverFromCorruption).toBe(false);

    const first = turn({ sessionId: "chat-1", spanId: "backfill-1", costSource: "real" });
    expect(database.insertTurn(first, 0.01, 1, "Org/Repo")).toBe(true);
    expect(database.insertTurn(first, 0.01, 1, "Org/Repo")).toBe(false);
    expect(database.insertTurn({ ...first, spanId: "backfill-2" }, 0.02, 2, "Org/Repo")).toBe(true);
    expect(database.insertTurn({ ...first, spanId: "backfill-3" }, 0.03, 3, "Org/Repo")).toBe(true);
    expect(database.insertTurn(turn({ sessionId: "chat-1" }), 0.5, 50, "Org/Repo")).toBe(false);
    expect(database.getCostSince(0)).toMatchObject({ credits: 6, turns: 3 });

    database.close();
    database = new CostDatabase(storageDir);
    await database.initialize();
    expect(database.getCostSince(0)).toMatchObject({ credits: 6, turns: 3 });
    expect(database.insertTurn(first, 0.01, 1, "Org/Repo")).toBe(false);
  });

  it("filters totals by source and counts LLM requests as turns", () => {
    database.insertTurn(turn({ timestamp: 1_000 }), 0.01, 1, "Org/Repo");
    database.replaceCliSession(cliState("cli-1"), cliInfo(), [cliRow()]);

    expect(database.getCostSince(0)).toMatchObject({ credits: 6, turns: 4 });
    expect(database.getCostSince(0, undefined, "chat")).toMatchObject({ credits: 1, turns: 1 });
    expect(database.getCostSince(0, undefined, "cli")).toMatchObject({ credits: 5, turns: 3 });
    expect(database.getCreditsSince(0, "chat")).toBe(1);
    expect(database.getCostBySourceSince(0)).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "chat", credits: 1, turns: 1 }),
      expect.objectContaining({ source: "cli", credits: 5, turns: 3 }),
    ]));
    expect(database.getSessionSummaries(undefined, 10, "cli")).toEqual([
      expect.objectContaining({ sessionId: "cli-1", source: "cli", turnCount: 3, title: "Run tests" }),
    ]);
    expect(database.getModelBreakdownSince(0, undefined, "cli")).toEqual([expect.objectContaining({ turnCount: 3 })]);
  });

  it("keeps the Chat watermark and Chat-only analytics free of CLI rows", () => {
    database.insertTurn(turn({ timestamp: 1_000 }), 0.01, 1, "Org/Repo");
    database.replaceCliSession(cliState("cli-1"), cliInfo(), [cliRow({ model: "claude-sonnet-5", modelFamily: "claude-sonnet-5" })]);

    expect(database.getMaxTimestamp()).toBe(1_000);
    expect(database.getMostRecentModel()).toBe("gpt-5");
  });

  it("replaces a CLI session's rows and skips rewriting identical usage", async () => {
    expect(database.replaceCliSession(cliState("cli-1"), cliInfo(), [cliRow(), cliRow({ timestamp: 6_000 }, 2)])).toBe(true);
    await database.save();
    const writeFile = vi.spyOn(fs.promises, "writeFile");

    expect(database.replaceCliSession(cliState("cli-1"), cliInfo(), [cliRow({ timestamp: 6_000 }, 2), cliRow()])).toBe(false);
    await database.save();
    expect(writeFile).not.toHaveBeenCalled();

    expect(database.replaceCliSession(cliState("cli-1"), cliInfo({ lastTimestamp: 7_000 }), [cliRow({ timestamp: 7_000 }, 4)])).toBe(true);
    expect(database.getAllTurns().map((t) => [t.timestamp, t.credits])).toEqual([[7_000, 4]]);
    expect(database.replaceCliSession({ ...cliState("cli-1"), status: "shadowed" }, null, [])).toBe(true);
    expect(database.getAllTurns()).toHaveLength(0);
  });

  it("does not merge CLI sessions that share a generated title", () => {
    database.replaceCliSession(cliState("cli-1"), cliInfo(), [cliRow()]);
    database.replaceCliSession(cliState("cli-2"), cliInfo({ startTimestamp: 5_500, lastTimestamp: 5_500 }), [cliRow({ timestamp: 5_500 })]);

    database.runLegacySessionDedupMigration();

    expect(database.getSessionSummaries(undefined, 10, "cli").map((s) => s.sessionId).sort()).toEqual(["cli-1", "cli-2"]);
  });
});
