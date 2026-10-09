import * as fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";
import { CostDatabase, setWasmPath } from "../src/database/costDatabase";
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
    expect(database.insertTurn(turn({ costSource: "real" }), 0.03, 3, "workspace")).toBe(false);
    expect(database.insertTurn(turn({ costSource: "real" }), 0.02, 2, "Org/Repo")).toBe(true);
    expect(database.insertTurn(turn(), 0.5, 50, "other-workspace")).toBe(false);

    expect(database.getAllTurns()).toEqual([
      expect.objectContaining({ credits: 2, costSource: "real", workspace: "Org/Repo" }),
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
