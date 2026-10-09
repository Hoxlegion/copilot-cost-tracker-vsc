import * as fs from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CostDatabase, setWasmPath } from "../src/database/costDatabase";
import { CliIngester } from "../src/watcher/cliIngester";
import type { ConfigManager } from "../src/config";
import type { ParsedTurn } from "../src/parser/types";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

let eventCounter = 0;
function line(type: string, timestamp: string, data: Record<string, unknown>): string {
  eventCounter++;
  return JSON.stringify({ type, data, id: `event-${eventCounter}`, timestamp, parentId: null });
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function startLine(timestamp: string, gitRoot?: string): string {
  return line("session.start", timestamp, {
    sessionId: "ignored",
    copilotVersion: "1.0.78",
    startTime: timestamp,
    context: { cwd: gitRoot ?? "C:\\nowhere", ...(gitRoot ? { gitRoot } : {}), repository: "org/project/repo" },
  });
}

function recordLine(timestamp: string, seq: number, model: string, nanoAiu?: number): string {
  return line("session.usage_record", timestamp, {
    usage: {
      model,
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 600,
      cacheWriteTokens: 0,
      duration: 500,
      isByok: false,
      ...(nanoAiu === undefined ? {} : {
        copilotUsage: { totalNanoAiu: nanoAiu, tokenDetails: [{ tokenType: "input", tokenCount: 400 }] },
      }),
      accounting: { sourceSessionId: "source", sequence: seq, usageId: `usage-${seq}` },
    },
  });
}

function assistantLine(timestamp: string): string {
  return line("assistant.message", timestamp, { content: "not parsed" });
}

function chatTurn(sessionId: string): ParsedTurn {
  return {
    sessionId, timestamp: Date.now() - 2 * MINUTE, duration: 100, agentName: "panel/editAgent",
    model: "gpt-5", modelFamily: "gpt-5", inputTokens: 10, outputTokens: 2, cachedTokens: 0,
    cacheWriteTokens: 0, totalTokens: 12, status: "ok", costSource: "real",
  };
}

describe("CliIngester", () => {
  let root: string;
  let home: string;
  let database: CostDatabase;
  let config: { cliEnabled: boolean; cliHomePaths: string[]; excludedModels: string[]; retentionDays: number };
  const pricing = { calculateCost: vi.fn(() => 0.02), costToCredits: (costUsd: number) => costUsd * 100 };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };

  beforeEach(async () => {
    setWasmPath(require.resolve("sql.js/dist/sql-wasm.wasm"));
    root = await mkdtemp(join(tmpdir(), "cli-ingest-"));
    home = join(root, "home");
    await mkdir(join(root, "storage"));
    database = new CostDatabase(join(root, "storage"));
    await database.initialize();
    config = { cliEnabled: true, cliHomePaths: [home], excludedModels: [], retentionDays: 90 };
    pricing.calculateCost.mockClear();
    logger.warn.mockClear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  /** A fresh instance has no scan throttle; the fingerprints live in the database. */
  function createIngester(): CliIngester {
    return new CliIngester(database, pricing, { config } as unknown as Pick<ConfigManager, "config">, logger);
  }

  async function writeSession(
    sessionId: string,
    lines: string[],
    options: { homeDir?: string; yaml?: string; metadata?: Record<string, unknown> } = {},
  ): Promise<string> {
    const dir = join(options.homeDir ?? home, "session-state", sessionId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "events.jsonl");
    await writeFile(filePath, `${lines.join("\n")}\n`);
    if (options.yaml) await writeFile(join(dir, "workspace.yaml"), options.yaml);
    if (options.metadata) await writeFile(join(dir, "vscode.metadata.json"), JSON.stringify(options.metadata));
    return filePath;
  }

  const cliTurns = (sessionId?: string) =>
    database.getAllTurns().filter((t) => t.source === "cli" && (sessionId === undefined || t.sessionId === sessionId));
  const credits = (turns: Array<{ credits: number }>) => turns.reduce((sum, t) => sum + t.credits, 0);

  it("imports billed usage per model call, labelled and titled like Copilot Chat sessions", async () => {
    const repo = join(root, "repo");
    await mkdir(join(repo, ".git"), { recursive: true });
    await writeFile(join(repo, ".git", "config"), '[remote "origin"]\n\turl = https://github.com/Org/Repo.git\n');
    await writeSession("session-a", [
      startLine(ago(30 * MINUTE), repo),
      recordLine(ago(29 * MINUTE), 1, "claude-sonnet-5", 2_500_000_000),
      assistantLine(ago(29 * MINUTE)),
      recordLine(ago(28 * MINUTE), 2, "claude-sonnet-5", 500_000_000),
    ], { yaml: "name: Generated title\n", metadata: { customTitle: "Renamed in VS Code" } });

    expect(await createIngester().ingest()).toEqual({ sessions: 1, turns: 2 });

    const turns = cliTurns();
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      sessionId: "session-a", agentName: "copilot-cli", workspace: "Org/Repo", costSource: "real",
      requestCount: 1, inputTokens: 400, cachedTokens: 600, outputTokens: 100,
    });
    expect(credits(turns)).toBeCloseTo(3, 9);
    expect(turns.reduce((sum, t) => sum + t.costUsd, 0)).toBeCloseTo(0.03, 9);
    expect(database.getSessionSummaries(undefined, 10, "cli")).toEqual([
      expect.objectContaining({ sessionId: "session-a", source: "cli", title: "Renamed in VS Code", turnCount: 2 }),
    ]);
    expect(pricing.calculateCost).not.toHaveBeenCalled();
  });

  it("re-imports a forced or appended log without double counting or rewriting unchanged data", async () => {
    const filePath = await writeSession("session-b", [
      startLine(ago(30 * MINUTE)),
      recordLine(ago(29 * MINUTE), 1, "gpt-5", 1_000_000_000),
    ]);
    expect(await createIngester().ingest()).toEqual({ sessions: 1, turns: 1 });
    await database.save();

    const writes = vi.spyOn(fs.promises, "writeFile");
    expect(await createIngester().ingest()).toEqual({ sessions: 0, turns: 0 });
    expect(await createIngester().ingest({ force: true })).toEqual({ sessions: 0, turns: 0 });
    await database.save();
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();

    fs.appendFileSync(filePath, `${recordLine(ago(20 * MINUTE), 2, "gpt-5", 2_000_000_000)}\n${line("session.usage_checkpoint", ago(20 * MINUTE), {
      totalNanoAiu: 3_000_000_000,
      usageAccountingWatermarks: { source: 2 },
      accountingSnapshot: { modelMetrics: { "gpt-5": {
        requests: { count: 2 }, usage: { inputTokens: 2000, outputTokens: 200, cacheReadTokens: 1200, cacheWriteTokens: 0 },
        tokenDetails: { input: { tokenCount: 800 } }, totalNanoAiu: 3_000_000_000,
      } } },
    })}\n`);
    expect(await createIngester().ingest()).toEqual({ sessions: 1, turns: 2 });
    expect(cliTurns("session-b")).toHaveLength(2);
    expect(credits(cliTurns("session-b"))).toBeCloseTo(3, 9);
  });

  it("counts a session found in several CLI homes once, using its newest log", async () => {
    const otherHome = join(root, "wsl-home");
    config.cliHomePaths = [home, otherHome];
    const older = await writeSession("session-c", [
      startLine(ago(30 * MINUTE)),
      recordLine(ago(29 * MINUTE), 1, "gpt-5", 1_000_000_000),
    ]);
    await writeSession("session-c", [
      startLine(ago(30 * MINUTE)),
      recordLine(ago(29 * MINUTE), 1, "gpt-5", 1_000_000_000),
      recordLine(ago(25 * MINUTE), 2, "gpt-5", 1_000_000_000),
    ], { homeDir: otherHome });
    const past = new Date(Date.now() - DAY);
    await utimes(older, past, past);

    expect(await createIngester().ingest()).toEqual({ sessions: 1, turns: 2 });
    expect(credits(cliTurns("session-c"))).toBeCloseTo(2, 9);
    expect(database.getCliSourceStates().get("session-c")?.filePath).toContain("wsl-home");
  });

  it("keeps the Copilot Chat data when Chat also recorded the session", async () => {
    database.insertTurn(chatTurn("session-both"), 0.01, 1, "Org/Repo");
    await writeSession("session-both", [startLine(ago(30 * MINUTE)), recordLine(ago(29 * MINUTE), 1, "gpt-5", 1_000_000_000)]);
    await writeSession("session-later", [startLine(ago(30 * MINUTE)), recordLine(ago(29 * MINUTE), 1, "gpt-5", 1_000_000_000)]);

    await createIngester().ingest();
    expect(cliTurns("session-both")).toHaveLength(0);
    expect(cliTurns("session-later")).toHaveLength(1);
    expect(database.getCliSourceStates().get("session-both")?.status).toBe("shadowed");
    expect(logger.warn).toHaveBeenCalledTimes(1);

    // Chat data that arrives after the CLI import wins as well.
    database.insertTurn(chatTurn("session-later"), 0.01, 1, "Org/Repo");
    expect((await createIngester().ingest()).sessions).toBe(1);
    expect(cliTurns()).toHaveLength(0);
    expect(database.getCliSourceStates().get("session-later")?.status).toBe("shadowed");
    expect(database.getCostSince(0)).toMatchObject({ credits: 2, turns: 2 });
  });

  it("applies excluded models and the retention window", async () => {
    config.excludedModels = ["MINI"];
    config.retentionDays = 1;
    await writeSession("session-d", [
      startLine(ago(3 * DAY)),
      recordLine(ago(2 * DAY), 1, "gpt-5", 7_000_000_000),
      recordLine(ago(10 * MINUTE), 2, "gpt-5-mini", 5_000_000_000),
      recordLine(ago(9 * MINUTE), 3, "gpt-5", 1_000_000_000),
    ]);

    await createIngester().ingest();
    expect(cliTurns().map((t) => [t.model, t.credits])).toEqual([["gpt-5", 1]]);
  });

  it("estimates the cost of usage without a billed amount", async () => {
    await writeSession("session-e", [startLine(ago(30 * MINUTE)), recordLine(ago(29 * MINUTE), 1, "gpt-5")]);

    await createIngester().ingest();
    expect(pricing.calculateCost).toHaveBeenCalledWith("gpt-5", 400, 100, 600, 0);
    expect(cliTurns()).toEqual([expect.objectContaining({ costSource: "estimated", costUsd: 0.02, credits: 2 })]);
  });

  it("records sessions without saved usage for the missing-usage hint", async () => {
    await writeSession("session-f", [startLine(ago(30 * MINUTE)), assistantLine(ago(29 * MINUTE))]);
    await writeSession("session-g", [startLine(ago(30 * MINUTE))]);

    expect(await createIngester().ingest()).toEqual({ sessions: 2, turns: 0 });
    expect(cliTurns()).toHaveLength(0);
    expect(database.getCliSourceStates().get("session-f")?.status).toBe("no_usage");
    expect(database.getCliSourceStates().get("session-g")?.status).toBe("empty");
    expect(database.countCliSessionsWithoutUsage(Date.now() - DAY)).toBe(1);
    expect(database.countCliSessionsWithoutUsage(Date.now())).toBe(0);
  });

  it("ignores unexpected session folder names", async () => {
    await writeSession("not a session!", [startLine(ago(30 * MINUTE)), recordLine(ago(29 * MINUTE), 1, "gpt-5", 1_000_000_000)]);

    expect(await createIngester().ingest()).toEqual({ sessions: 0, turns: 0 });
    expect(database.getCliSourceStates().size).toBe(0);
  });

  it("does nothing while CLI tracking is disabled", async () => {
    config.cliEnabled = false;
    await writeSession("session-h", [startLine(ago(30 * MINUTE)), recordLine(ago(29 * MINUTE), 1, "gpt-5", 1_000_000_000)]);

    expect(await createIngester().ingest({ force: true })).toEqual({ sessions: 0, turns: 0 });
    expect(database.getCliSourceStates().size).toBe(0);
  });

  it("throttles scans unless forced or invalidated", async () => {
    const ingester = createIngester();
    await writeSession("session-i", [startLine(ago(30 * MINUTE)), recordLine(ago(29 * MINUTE), 1, "gpt-5", 1_000_000_000)]);
    expect((await ingester.ingest()).sessions).toBe(1);

    await writeSession("session-j", [startLine(ago(30 * MINUTE)), recordLine(ago(29 * MINUTE), 1, "gpt-5", 1_000_000_000)]);
    expect((await ingester.ingest()).sessions).toBe(0);
    expect((await ingester.ingest({ force: true })).sessions).toBe(1);

    await writeSession("session-k", [startLine(ago(30 * MINUTE)), recordLine(ago(29 * MINUTE), 1, "gpt-5", 1_000_000_000)]);
    ingester.invalidate();
    expect((await ingester.ingest()).sessions).toBe(1);
    expect(cliTurns()).toHaveLength(3);
  });
});
